import { execFileSync } from "node:child_process";
import net, { type AddressInfo } from "node:net";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import type { Message, Task, Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

for (const mode of ["dark", "light"] as const) {
  test(`task status hover keeps ${mode} surfaces and readable semantic colors`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("apx.mode", value), mode);
    await rpc("setup.finish", {});
    const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Task hint project" });
    const agent = await rpc<{ id: string }>("agents.create", {
      project_id: project.id,
      slug: "builder",
      name: "Builder",
    });
    const task = await rpc<Task>("tasks.create", {
      title: `Task hint ${mode}: audit and update the documentation for the task workflow, including archived conversations and status transitions without losing any details`,
      description: "Check the task status hint.",
      status: "doing",
      project: project.id,
      assignee: agent.id,
    });
    await expect
      .poll(async () => (await rpc<{ sessions: Thread[] }>("tasks.get", { task: task.id })).sessions.length)
      .toBe(1);
    await rpc("tasks.close", { task: task.id, state: "done" });
    await open(page);
    const title = page.locator(".taskbundle__title").filter({ hasText: task.title });
    await title.hover();
    const hint = page.locator(".apx-tooltip[data-open]");
    await expect(hint.locator(".task-status-hint__title")).toHaveText(task.title);
    await expect(hint.locator(".apx-badge")).toHaveText("Hecha");
    await expect(hint).toHaveText(`${task.title}Hecha`);
    const titleLayout = await hint.locator(".task-status-hint__title").evaluate((el) => ({
      whiteSpace: getComputedStyle(el).whiteSpace,
      fits: el.scrollWidth <= el.clientWidth,
      wrapped: el.getBoundingClientRect().height > Number.parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(titleLayout).toEqual({ whiteSpace: "normal", fits: true, wrapped: true });
    const colors = await hint.evaluate((el) => {
      const rgb = (value: string) => {
        const channels = value.match(/[\d.]+/g);
        if (!channels || channels.length < 3) throw new Error(`Unsupported color: ${value}`);
        return channels.map(Number);
      };
      const luminance = (color: number[]) =>
        color.slice(0, 3).reduce((sum, channel, i) => {
          const v = channel / 255;
          return (
            sum +
            (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * ([0.2126, 0.7152, 0.0722][i] ?? Number.NaN)
          );
        }, 0);
      const surface = rgb(getComputedStyle(el).backgroundColor);
      const badgeElement = el.querySelector(".apx-badge");
      if (!badgeElement) throw new Error("Missing task status badge");
      const badge = getComputedStyle(badgeElement);
      const fill = rgb(badge.backgroundColor);
      const alpha = fill[3] ?? 1;
      const background = fill.slice(0, 3).map((v, i) => v * alpha + (surface[i] ?? Number.NaN) * (1 - alpha));
      const foreground = luminance(rgb(badge.color));
      const backdrop = luminance(background);
      return {
        surface: luminance(surface),
        contrast: (Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05),
      };
    });
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
    if (mode === "dark") expect(colors.surface).toBeLessThan(0.1);
    else expect(colors.surface).toBeGreaterThan(0.6);
    await expect(hint.locator(".apx-badge__dot")).toBeVisible();
  });
}

test("task context actions keep status live and archived conversations remain readable", async ({ page }) => {
  const health = await rpc<{ code_sha: string }>("system.health", {});
  expect(health.code_sha).toBe(execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim());
  await rpc("setup.finish", {});
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Task actions project" });
  const agent = await rpc<{ id: string }>("agents.create", {
    project_id: project.id,
    slug: "builder",
    name: "Builder",
  });
  const task = await rpc<Task>("tasks.create", {
    title: "Check task actions",
    description: "Check the task actions and preserve this conversation.",
    status: "doing",
    project: project.id,
    assignee: agent.id,
  });
  const unrelated = await rpc<Thread>("threads.create", {
    kind: "agent",
    project_id: project.id,
    agent_id: agent.id,
    title: "Unrelated chat",
  });
  await expect
    .poll(async () => (await rpc<{ sessions: Thread[] }>("tasks.get", { task: task.id })).sessions.length)
    .toBe(1);
  await open(page);
  const bundle = page.locator(".taskbundle").filter({ hasText: task.title });
  await expect(bundle).toBeVisible();
  await bundle.locator(".tree__session").click();
  const header = page.locator(".chat__header");
  const status = header.getByRole("status");
  await expect(status).toHaveText("En curso");
  await bundle.locator(".taskbundle__task").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Mover a", exact: true }).hover();
  const reviewOption = page.getByRole("menuitem", { name: "Revisión", exact: true });
  await expect(reviewOption).toBeVisible();
  const optionBounds = await reviewOption.boundingBox();
  expect(optionBounds?.height).toBeGreaterThan(20);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await bundle.locator(".taskbundle__task").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Espera tu respuesta", exact: true }).click();
  await expect(status).toHaveText("Necesita tu revisión");
  await expect(bundle.locator(".taskbundle__title")).toHaveText(task.title);
  await expect(bundle.locator(".apx-badge")).toHaveCount(0);
  await expect(status.locator(".apx-badge")).toHaveClass(/apx-tone--warning/);
  await header.hover();
  await bundle.locator(".taskbundle__title").hover();
  const hint = page.locator(".apx-tooltip[data-open]");
  await expect(hint.locator(".task-status-hint__title")).toHaveText(task.title);
  await expect(hint.locator(".apx-badge")).toHaveText("Necesita tu revisión");
  await expect(hint.locator(".apx-badge__dot")).toBeVisible();
  await expect(hint.locator(".apx-badge")).toHaveClass(/apx-tone--warning/);
  // The explicit overflow menu works on touch and from the keyboard without a right click.
  await bundle.getByRole("button", { name: "Acciones de la tarea" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Mover a", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Revisión", exact: true }).click();
  await expect(status).toHaveText("Revisión");
  await bundle.getByRole("button", { name: "Acciones de la tarea" }).click();
  await page.getByRole("menuitem", { name: "Hecha", exact: true }).click();
  await expect(status).toHaveText("Hecha");
  await expect(status.locator(".apx-badge")).toHaveClass(/apx-tone--brand/);
  await bundle.locator(".taskbundle__task").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Mover a", exact: true })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Reabrir", exact: true }).click();
  await expect(status).toHaveText("Revisión");
  await bundle.getByRole("button", { name: "Acciones de la tarea" }).click();
  await page.getByRole("menuitem", { name: "Archivar chats de la tarea", exact: true }).click();
  await expect(bundle).toHaveCount(0);
  const detail = await rpc<{ task: Task; sessions: Thread[] }>("tasks.get", { task: task.id });
  expect(detail.task.state).toBe("open");
  expect(detail.sessions.every((s) => s.archived)).toBe(true);
  expect((await rpc<{ thread: Thread }>("threads.get", { thread: unrelated.id })).thread.archived).toBeFalsy();
  const before = await rpc<{ runs: unknown[] }>("runs.list", { agent: agent.id });
  await header.getByRole("button", { name: "Ver la tarea" }).click();
  const panel = page.getByRole("complementary", { name: task.title });
  await panel.getByRole("button", { name: "Sesiones · 1", exact: true }).click();
  await panel.locator(".taskwork__chat").click();
  await expect(header).toContainText("Builder");
  await expect(page.locator(".chat__scroll").first()).toBeVisible();
  expect((await rpc<{ thread: Thread }>("threads.get", { thread: detail.sessions[0]?.id })).thread.archived).toBe(true);
  expect(await rpc("runs.list", { agent: agent.id })).toEqual(before);
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  const taskRow = page.getByRole("region", { name: "Tareas" }).getByText(task.title, { exact: true });
  await taskRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Desarchivar chats de la tarea", exact: true }).click();
  await expect
    .poll(async () =>
      (await rpc<{ sessions: Thread[] }>("tasks.get", { task: task.id })).sessions.every((s) => !s.archived),
    )
    .toBe(true);
  expect(await rpc("runs.list", { agent: agent.id })).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, `#project=${project.id}&tab=chats&thread=${detail.sessions[0]?.id}`);
  await expect(header.getByRole("status").locator(".apx-badge")).toBeVisible();
  const bounds = await header.getByRole("status").boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds && bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await header.getByRole("button", { name: "Volver a los chats" }).click();
  await bundle.getByRole("button", { name: "Acciones de la tarea" }).click();
  await expect(page.getByRole("menuitem", { name: "Archivar chats de la tarea", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the initial task instruction shows a formatted description without adding messages or resuming work", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const description = "First line\nSecond line\n\nAnother paragraph\n\n- First item\n- Second item";
  const task = await rpc<Task>("tasks.create", {
    title: "Readable task description",
    description,
    assignee: "roby",
  });
  let session = "";
  await expect
    .poll(async () => {
      const detail = await rpc<{ sessions: Thread[] }>("tasks.get", { task: task.id });
      session = detail.sessions[0]?.id ?? "";
      return session;
    })
    .not.toBe("");
  await expect
    .poll(async () => (await rpc<{ thread: Thread }>("threads.get", { thread: session })).thread.state)
    .toBe("idle");
  const initial = await rpc<{ messages: Message[] }>("threads.get", { thread: session });
  // Reproduce the existing generic kickoff through the public message editor, without altering task execution code.
  await rpc("threads.rewind", { thread: session, message: initial.messages[0]?.id, text: "Work on this task." });
  await expect
    .poll(async () => (await rpc<{ thread: Thread }>("threads.get", { thread: session })).thread.state)
    .toBe("idle");
  await rpc("threads.read", { thread: session });
  const before = await rpc("threads.get", { thread: session });
  const runs = await rpc("runs.list", { agent: "roby" });
  await open(page, `#thread=${session}`);
  const block = page.getByRole("region", { name: "Descripción", exact: true });
  await expect(block).toHaveCount(1);
  await expect(block.locator("p").first()).toHaveText("First line\nSecond line", { useInnerText: true });
  await expect(block.locator("p").first().locator("br")).toHaveCount(1);
  await expect(block.locator("p").first()).toHaveCSS("white-space", "pre-wrap");
  await expect(block.locator("p")).toHaveCount(2);
  await expect(block.locator("li")).toHaveText(["First item", "Second item"]);
  await page.reload();
  await expect(block).toHaveCount(1);
  expect(await rpc("threads.get", { thread: session })).toEqual(before);
  expect(await rpc("runs.list", { agent: "roby" })).toEqual(runs);
  await page.locator(".chat__header").getByRole("button", { name: "Ver la tarea" }).click();
  await expect(page.getByRole("textbox", { name: "Descripción", exact: true })).toHaveValue(description);
  await rpc("tasks.update", { task: task.id, description: "" });
  await expect(block).toHaveCount(0);
  expect(await rpc("runs.list", { agent: "roby" })).toEqual(runs);
});

test("an agent-created task shows its real generic kickoff with the formatted description", async ({ page }) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const description = "First line\nSecond line\n\nAnother paragraph\n\n- First item\n- Second item";
  const env = await startCore({
    port,
    llm: scriptedLlm((_req, { said, afterTool }) => {
      if (said.includes("Work on this task.")) return say("Task received.");
      if (afterTool) return say("Work transferred.");
      return callTool("create", "task_create", {
        title: "Real task kickoff",
        description,
        assignee: "roby",
      });
    }),
  });
  try {
    await env.client.call("setup.finish", {});
    const source = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: source.id, text: "Create and work on the task." });
    let taskId = "";
    await expect
      .poll(async () => {
        const tasks = await env.client.call("tasks.list", {});
        taskId = tasks.tasks.find((t) => t.title === "Real task kickoff")?.id ?? "";
        return taskId;
      })
      .not.toBe("");
    let session = "";
    await expect
      .poll(async () => {
        const detail = await env.client.call("tasks.get", { task: taskId });
        session = detail.sessions[0]?.id ?? "";
        return session && (await env.client.call("threads.get", { thread: session })).thread.state;
      })
      .toBe("idle");
    const initial = await env.client.call("threads.get", { thread: session });
    expect(initial.messages[0]?.parts).toEqual([{ type: "text", text: "Work on this task." }]);
    const runs = await env.client.call("runs.list", { agent: "roby" });
    await page.goto(`${env.core.url}/#thread=${session}`);
    const block = page.getByRole("region", { name: "Descripción", exact: true });
    await expect(block).toHaveCount(1);
    await expect(block.locator("p").first()).toHaveText("First line\nSecond line", { useInnerText: true });
    await expect(block.locator("li")).toHaveText(["First item", "Second item"]);
    await page.reload();
    await expect(block).toHaveCount(1);
    expect((await env.client.call("threads.get", { thread: session })).messages).toEqual(initial.messages);
    expect(await env.client.call("runs.list", { agent: "roby" })).toEqual(runs);
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
