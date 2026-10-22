import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test("tarea: equipo del proyecto, menciones, respuesta, estados y comentario separado del historial", async ({
  page,
}, info) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  let taskId = "";
  const env = await startCore({
    port,
    llm: scriptedLlm((_req, { system, afterTool, said }) => {
      if (system.startsWith("You are Builder")) {
        if (afterTool) return say("Review completed. @roby please check.");
        // Assigned, Builder starts in its chat for the task; asked to review, it moves the task and says so.
        return said.includes("please review")
          ? callTool("review", "task_update", { task: taskId, status: "review" })
          : say("On it.");
      }
      return say("@owner please approve the review.");
    }),
  });
  try {
    await env.client.call("setup.finish", {});
    await env.client.call("agents.update", { agent: "roby", name: "Roby" });
    await env.client.call("owner.set", { name: "Alex" });
    await env.client.call("agents.create", { slug: "andy", name: "Andy" });
    const folder = path.join(env.home, "northwind");
    const otherFolder = path.join(env.home, "globex");
    for (const dir of [folder, otherFolder]) {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "AGENTS.md"), "# Project\n");
    }
    const project = (await env.client.call("projects.register", { path: folder })).project;
    const otherProject = (await env.client.call("projects.register", { path: otherFolder })).project;
    const builder = await env.client.call("agents.create", {
      project_id: project.id,
      slug: "builder",
      name: "Builder",
    });
    await env.client.call("agents.create", { project_id: otherProject.id, slug: "other", name: "Other helper" });
    const task = await env.client.call("tasks.create", {
      title: "Review Northwind onboarding",
      description: Array.from({ length: 10 }, (_, i) => `Review step ${i + 1}`).join("\n"),
      project: project.id,
    });
    taskId = task.id;
    await env.client.call("tasks.create", { title: "Second Northwind task", description: "desc", project: project.id });
    const health = await env.client.call("system.health", {});
    expect(health.code_sha).toBeTruthy();
    await page.goto(env.core.url);
    await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
    await page.getByText(task.title, { exact: true }).click();
    const drawer = page.getByRole("complementary", { name: task.title });
    const body = drawer.locator(".taskpanel__body");
    const comment = drawer.getByRole("textbox", { name: "Comentario", exact: true });
    const description = drawer.getByRole("textbox", { name: "Descripción", exact: true });
    expect((await description.boundingBox())?.height).toBeGreaterThanOrEqual(180);
    // The list moves aside for the open task instead of staying under it.
    await expect
      .poll(async () => {
        const list = await page.locator(".tasks").boundingBox();
        const panel = await drawer.boundingBox();
        return list && panel ? list.x + list.width <= panel.x : false;
      })
      .toBe(true);
    // The description reads like editable text, not a disabled field.
    const colorOf = (el: Element) => getComputedStyle(el).color;
    expect(await description.evaluate(colorOf)).toBe(await drawer.locator(".drawer__title").evaluate(colorOf));
    // The "?" after the column says what each column is for, and Escape closes only that.
    await drawer.getByRole("button", { name: "Sobre las columnas" }).click();
    await expect(page.getByRole("dialog", { name: "Sobre las columnas" })).toContainText(
      "Decidida: es lo próximo a hacer.",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Sobre las columnas" })).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await drawer.getByRole("combobox", { name: "Agente", exact: true }).click();
    await expect(page.getByRole("option")).toHaveText(["Nadie", /^Roby/, "Builder"]);
    await page
      .getByRole("option")
      .filter({ hasText: /^Builder$/ })
      .click();
    await expect
      .poll(async () => (await env.client.call("tasks.get", { task: task.id })).task.assignee)
      .toBe(builder.id);

    await drawer.getByRole("combobox", { name: "Columna", exact: true }).click();
    await page.getByRole("option", { name: "En curso", exact: true }).click();
    await expect.poll(async () => (await env.client.call("tasks.get", { task: task.id })).task.status).toBe("doing");

    // The comment belongs to the conversation (in its tab, right under it) and stays at the panel's bottom edge.
    await expect(drawer.getByRole("tabpanel").getByRole("textbox", { name: "Comentario", exact: true })).toHaveCount(1);
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const [box, view] = [await comment.boundingBox(), await body.boundingBox()];
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((view?.y ?? 0) + (view?.height ?? 0) + 1);
    await comment.fill("@missing");
    await expect(drawer.getByText("Sin agentes coincidentes")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer.getByRole("listbox", { name: "Mencionar agente" })).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await comment.fill("@");
    const mentions = drawer.getByRole("listbox", { name: "Mencionar agente" });
    await expect(mentions.getByRole("option")).toHaveText(["Roby@roby", "Builder@builder"]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(comment).toHaveValue("@builder ");
    await comment.pressSequentially("please review");
    await drawer.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(drawer.getByText("Review completed. @roby please check.", { exact: true })).toBeVisible();
    // Mentions read as badges, in the owner's comment and in an agent's answer.
    await expect(drawer.locator(".apx-msg--user .apx-mention", { hasText: "@builder" }).first()).toBeVisible();
    await expect(drawer.locator(".apx-msg--agent .apx-mention", { hasText: "@roby" }).first()).toBeVisible();
    await expect.poll(async () => (await env.client.call("tasks.get", { task: task.id })).task.status).toBe("review");
    // Builder's @roby asks nobody: an agent asks with delegate (DECISIONS.md#d-078).
    expect((await env.client.call("tasks.get", { task: task.id })).consults).toHaveLength(0);
    // The owner's @roby does: Roby answers in a consult, shown as a card on the task.
    await comment.fill("@roby can you approve it?");
    await drawer.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(drawer.getByText("@owner please approve the review.", { exact: true })).toBeVisible();
    // Builder, the task's agent, worked in its chat for it; Roby, mentioned, answered in a consult shown as a card.
    await expect
      .poll(async () => (await env.client.call("tasks.get", { task: task.id })).sessions.map((s) => s.agent_ids[0]))
      .toEqual([builder.id]);
    await expect(drawer.getByRole("button", { name: "Abrir conversación con Roby" })).toBeVisible();
    // Under its properties, its sessions list Roby's consult beside Builder's chat; the button beside them, its usage.
    await drawer.getByRole("button", { name: /^Sesiones · 2$/ }).click();
    await expect(drawer.locator(".taskwork__chat", { hasText: "Consulta" })).toContainText("Roby");
    await drawer.getByRole("button", { name: /^Consumo · \d/ }).click();
    await expect(drawer.locator(".taskusage__total")).toContainText(/tokens de entrada · .* turnos/);
    expect((await env.client.call("threads.get", { thread: task.thread_id })).runs).toHaveLength(0);
    // Builder's answer when it started stays in its chat: the task shows only what answers the owner or reports.
    await expect(drawer.getByText("On it.", { exact: true })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Ver a Builder" }).first()).toBeVisible();
    // Answering a bubble quotes it and asks its agent again.
    const answer = drawer.locator(".apx-msg--agent", { hasText: "Review completed. @roby please check." });
    await answer.hover();
    await answer.getByRole("button", { name: "Responder", exact: true }).click();
    await expect(comment).toHaveValue("> Builder: Review completed. @roby please check.\n\n@builder ");
    await expect(comment).toBeFocused();
    await comment.fill("");
    await expect.poll(async () => (await env.client.call("tasks.get", { task: task.id })).task.awaits_owner).toBe(true);
    expect(
      (await env.client.call("notifications.list", {})).notifications.some((n) => n.ref === task.id && !n.read_at),
    ).toBe(true);

    await comment.fill("Draft to keep");
    await drawer.getByRole("tab", { name: /^Historial/ }).click();
    await expect(comment).toHaveCount(0);
    await expect(drawer.locator(".taskhistory__line")).not.toHaveCount(0);
    // What the owner did reads by their name, like an agent's line.
    await expect(drawer.getByText("Alex se la asignó a Builder", { exact: true })).toBeVisible();
    await drawer.getByRole("tab", { name: "Comentarios", exact: true }).click();
    await expect(comment).toHaveValue("Draft to keep");
    await expect(drawer.getByText("@owner please approve the review.", { exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath("task-conversation.png") });
    // Enter is a new line; Shift+Enter sends.
    await comment.fill("Approved");
    await comment.press("Enter");
    await expect(comment).toHaveValue("Approved\n");
    await comment.press("Shift+Enter");
    await expect(comment).toHaveValue("");
    await expect
      .poll(async () => (await env.client.call("tasks.get", { task: task.id })).task.awaits_owner)
      .toBe(false);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(comment).toBeVisible();
    await comment.fill("@b");
    await mentions.getByRole("option", { name: /Builder/ }).click();
    await expect(comment).toHaveValue("@builder ");
    await page.screenshot({ path: info.outputPath("task-mobile.png") });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByText("Second Northwind task", { exact: true }).click();
    const second = page.getByRole("complementary", { name: "Second Northwind task" });
    await expect(second.getByRole("textbox", { name: "Comentario", exact: true })).toHaveValue("");
    await expect(second.getByRole("tab", { name: "Comentarios", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByText(task.title, { exact: true }).click();
    await drawer.getByRole("button", { name: "Hecha", exact: true }).click();
    await expect.poll(async () => (await env.client.call("tasks.get", { task: task.id })).task.state).toBe("done");
    await drawer.getByRole("button", { name: "Reabrir", exact: true }).click();
    await expect.poll(async () => (await env.client.call("tasks.get", { task: task.id })).task.state).toBe("open");
    await env.client.call("tasks.update", { task: task.id, awaits_owner: true });
    await drawer.getByRole("combobox", { name: "Columna", exact: true }).click();
    await page.getByRole("option", { name: "En curso", exact: true }).click();
    await expect
      .poll(async () => (await env.client.call("tasks.get", { task: task.id })).task.awaits_owner)
      .toBe(false);
    await expect.poll(async () => (await env.client.call("tasks.get", { task: task.id })).task.status).toBe("doing");

    // Its sessions list the agents' chats for it; one opens in the inbox and links back to the task.
    await drawer.getByRole("button", { name: /^Sesiones · / }).click();
    await page.locator(".taskwork__chat", { hasText: "Builder" }).click();
    await expect(page.locator(".chat__header")).toContainText("Builder");
    await expect(page.getByRole("main").getByText("On it.", { exact: true })).toBeVisible();
    await page.locator(".chat__task").click();
    await expect(page.getByRole("complementary", { name: task.title })).toBeVisible();
    // A consult's card opens its chat from the task too, where no chat is open beside it.
    await page
      .getByRole("complementary", { name: task.title })
      .getByRole("button", { name: "Abrir conversación con Roby" })
      .click();
    await expect(page.locator(".chat__header")).toContainText("Roby");
  } finally {
    await page.goto("about:blank");
    // Detach the browser before stopping its server; reconnect timers must not outlive the fixture.
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
