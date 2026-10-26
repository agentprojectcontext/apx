import { execFileSync } from "node:child_process";
import type { Message, Task, Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

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
  await open(page, `#project=${project.id}&tab=chats`);
  const bundle = page.locator(".taskbundle").filter({ hasText: task.title });
  await expect(bundle).toBeVisible();
  await bundle.locator(".tree__session").click();
  const header = page.locator(".chat__header");
  const status = header.getByRole("status");
  await expect(status).toHaveText("En curso");
  await bundle.locator(".taskbundle__task").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Espera tu respuesta", exact: true }).click();
  await expect(status).toHaveText("Necesita tu revisión");
  await expect(bundle.getByRole("status")).toHaveText("Necesita tu revisión");
  // The explicit overflow menu works on touch and from the keyboard without a right click.
  await bundle.getByRole("button", { name: "Acciones de la tarea" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Mover a", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Revisión", exact: true }).click();
  await expect(status).toHaveText("Revisión");
  await bundle.getByRole("button", { name: "Acciones de la tarea" }).click();
  await page.getByRole("menuitem", { name: "Hecha", exact: true }).click();
  await expect(status).toHaveText("Hecha");
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
  await expect(header.getByRole("status").locator(".apx-tag")).toBeVisible();
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
