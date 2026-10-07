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
    llm: scriptedLlm((_req, { system, afterTool }) => {
      if (system.startsWith("You are Builder"))
        return afterTool
          ? say("Review completed. @roby please check.")
          : callTool("review", "task_update", { task: taskId, status: "review" });
      return say("@owner please approve the review.");
    }),
  });
  try {
    await env.client.call("setup.finish", {});
    await env.client.call("agents.update", { agent: "roby", name: "Roby" });
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
    await env.client.call("tasks.create", { title: "Second Northwind task", project: project.id });
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
    // The description reads like editable text, not a disabled field.
    const colorOf = (el: Element) => getComputedStyle(el).color;
    expect(await description.evaluate(colorOf)).toBe(await drawer.locator(".drawer__title").evaluate(colorOf));
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

    const before = await comment.boundingBox();
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect((await comment.boundingBox())?.y).toBe(before?.y);
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
    await expect(drawer.getByText("@owner please approve the review.", { exact: true })).toBeVisible();
    await expect.poll(async () => (await env.client.call("tasks.get", { task: task.id })).task.status).toBe("review");
    const runs = (await env.settle(task.thread_id)).runs;
    expect(runs.map((r) => r.agent_id).reverse()).toEqual([builder.id, "roby"]);
    await expect(drawer.getByRole("button", { name: "Ver a Builder" })).toBeVisible();
    await expect.poll(async () => (await env.client.call("tasks.get", { task: task.id })).task.awaits_owner).toBe(true);
    expect(
      (await env.client.call("notifications.list", {})).notifications.some((n) => n.ref === task.id && !n.read_at),
    ).toBe(true);

    await comment.fill("Draft to keep");
    await drawer.getByRole("tab", { name: /^Historial/ }).click();
    await expect(comment).toHaveCount(0);
    await expect(drawer.locator(".taskhistory__line")).not.toHaveCount(0);
    await drawer.getByRole("tab", { name: "Conversación", exact: true }).click();
    await expect(comment).toHaveValue("Draft to keep");
    await expect(drawer.getByText("@owner please approve the review.", { exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath("task-conversation.png") });
    await comment.fill("Approved");
    await drawer.getByRole("button", { name: "Enviar", exact: true }).click();
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
    await expect(second.getByRole("tab", { name: "Conversación", exact: true })).toHaveAttribute(
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
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
