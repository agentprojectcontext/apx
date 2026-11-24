import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

for (const width of [1280, 390]) {
  test(`task sections fold without indentation and keep task sessions out of Chats at ${width}px`, async ({
    page,
  }, info) => {
    const env = await startCore({ port: 0, llm: scriptedLlm(() => say("Ready.")) });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    try {
      await env.client.call("setup.finish", {});
      const work: Record<string, string> = {};
      for (const [title, status, state, waiting] of [
        ["Inventory running", "doing", "open", false],
        ["Inventory waiting", "doing", "open", true],
        ["Inventory pending", "todo", "open", false],
        ["Inventory agent review", "review", "open", false],
        ["Inventory dropped", "backlog", "dropped", false],
        ["Inventory done", "backlog", "done", false],
        ["Inventory done older", "backlog", "done", false],
      ] as const) {
        const task = await env.client.call("tasks.create", { title, status });
        const chat = env.core.store.threads.create({
          kind: "loose",
          title,
          agent_ids: ["superagent"],
          task_id: task.id,
        });
        await env.client.call("tasks.update", {
          task: task.id,
          awaits_owner: waiting,
          ...(status === "review" ? { reviewer: "superagent" } : {}),
        });
        if (state !== "open") await env.client.call("tasks.close", { task: task.id, state });
        work[title] = chat.id;
      }
      const code = env.core.store.threads.create({
        kind: "code",
        engine: "claude",
        title: "Inventory external session",
        agent_ids: ["superagent"],
        parent_id: work["Inventory pending"],
      });
      expect(code.task_id).toBeTruthy();
      const health = await env.client.call("system.health", {});
      await info.attach("runtime", {
        body: JSON.stringify({ url: env.core.url, code_sha: health.code_sha }),
        contentType: "application/json",
      });
      await page.goto(`${env.core.url}/?lang=es`);
      if (width < 600) await page.getByRole("button", { name: "Volver a los chats", exact: true }).click();
      const inbox = page.getByRole("region", { name: "Inbox", exact: true });
      await inbox.getByRole("radio", { name: /^Tareas/ }).click();
      await expect(inbox.locator(".inboxsec__heading")).toHaveText([
        "En curso1",
        "Te esperan1",
        "Pendientes2",
        "Descartadas1",
        "Listo2",
      ]);
      const sections = inbox.locator("section.inboxsec");
      for (const section of await sections.all())
        await expect(section.locator(".inboxsec__tasktoggle")).toHaveAttribute("aria-expanded", "true");
      const done = inbox.getByRole("region", { name: "Listo", exact: true });
      const toggle = done.getByRole("button", { name: "Listo 2", exact: true });
      await toggle.focus();
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(done.locator(".taskbundle").first()).not.toBeVisible();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const x = await inbox
        .locator(".taskbundle > .threadrow-wrap")
        .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().x));
      expect(x.length).toBe(7);
      expect(new Set(x).size).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: info.outputPath(`tasks-${width}.png`), fullPage: true });
      await toggle.click();
      await page.evaluate((thread) => {
        location.hash = `thread=${thread}`;
      }, work["Inventory done"]);
      if (width < 600)
        await page
          .getByRole("button", { name: /Volver/ })
          .first()
          .click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(done.locator(".taskbundle").filter({ hasText: "Inventory done" }).first()).toBeVisible();
      await inbox.getByRole("radio", { name: /^Chats/ }).click();
      await expect(inbox.locator(".threadrow", { hasText: "Inventory external session" })).toHaveCount(0);
      await inbox.getByRole("radio", { name: /^Tareas/ }).click();
      await expect(inbox.locator(".taskbundle", { hasText: "Inventory pending" })).toHaveCount(1);
      expect(errors).toEqual([]);
    } finally {
      await page.goto("about:blank");
      await env.core.close();
      await env.cleanup();
    }
  });
}
