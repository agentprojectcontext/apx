import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

for (const width of [1280, 390]) {
  test(`mixed external sessions and delegated chats expand without phantom counts at ${width}px`, async ({
    page,
  }, info) => {
    const env = await startCore({ port: 0, llm: scriptedLlm(() => say("Ready.")) });
    try {
      await env.client.call("setup.finish", {});
      const task = await env.client.call("tasks.create", { title: "Mixed session task", status: "doing" });
      for (let i = 0; i < 6; i++)
        env.core.store.threads.create({
          kind: i === 0 ? "agent" : "a2a",
          title: `Helper ${i}`,
          agent_ids: ["superagent"],
          parent_id: task.thread_id,
        });
      const sessions = ["Earlier external session", "Latest external session"].map((title) =>
        env.core.store.threads.create({
          kind: "code",
          engine: "claude",
          title,
          agent_ids: ["superagent"],
          parent_id: task.thread_id,
        }),
      );
      for (const [i, session] of sessions.entries())
        env.core.store.threads.settle(session.id, `209${i + 8}-01-01T00:00:00.000Z`, session.title);
      await info.attach("runtime", {
        body: JSON.stringify(await env.client.call("system.health", {})),
        contentType: "application/json",
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${env.core.url}/?lang=es`);
      if (width < 600) await page.getByRole("button", { name: "Volver a los chats", exact: true }).click();
      const inbox = page.getByRole("region", { name: "Inbox", exact: true });
      await inbox.getByRole("radio", { name: /^Tareas/ }).click();
      const bundle = inbox.locator(".taskbundle", { hasText: "Mixed session task" });
      await expect(bundle).toHaveCount(1);
      await expect(bundle.locator(".inboxtask__count").first()).toHaveText("8");
      const fold = bundle.locator(":scope > .threadrow-wrap .rowfold");
      await fold.click();
      await expect(bundle.locator(".tree__session")).toHaveCount(6);
      const more = bundle.getByRole("button", { name: "Ver 1 más", exact: true });
      await expect(more).toBeVisible();
      await more.click();
      await expect(bundle.locator(".tree__session")).toHaveCount(7);
      await expect(bundle.locator(".tree__more")).toHaveCount(0);
      await expect(bundle.locator(".inboxtask__count").first()).toHaveText("8");
      await expect(bundle.getByRole("button", { name: /Earlier external session/ })).toHaveCount(1);
      await page.screenshot({ path: info.outputPath(`mixed-expanded-${width}.png`), fullPage: true });
      await fold.click();
      await expect(bundle.locator(".tree__session")).toHaveCount(0);
      await fold.click();
      await expect(bundle.locator(".tree__session")).toHaveCount(6);
      await bundle.getByRole("button", { name: /Earlier external session/ }).click();
      await expect(page).toHaveURL(new RegExp(`thread=${sessions[0]?.id}`));
    } finally {
      await page.goto("about:blank");
      await env.core.close();
      await env.cleanup();
    }
  });
}

for (const [width, lang] of [
  [1280, "es"],
  [390, "es"],
  [1280, "en"],
  [390, "en"],
] as const) {
  const labels =
    lang === "es"
      ? {
          back: "Volver a los chats",
          tasks: /^Tareas/,
          sections: ["En curso", "Te esperan", "Pendientes", "Listo", "Descartadas"],
          search: "Buscar chats",
        }
      : {
          back: "Back to the chats",
          tasks: /^Tasks/,
          sections: ["In progress", "Waiting for you", "Pending", "Done", "Dropped"],
          search: "Search chats",
        };
  test(`task sections fold without indentation and keep task sessions out of Chats at ${width}px in ${lang}`, async ({
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
      await page.goto(`${env.core.url}/?lang=${lang}`);
      if (width < 600) await page.getByRole("button", { name: labels.back, exact: true }).click();
      const inbox = page.getByRole("region", { name: "Inbox", exact: true });
      await inbox.getByRole("radio", { name: labels.tasks }).click();
      await expect(inbox.locator(".inboxsec__heading")).toHaveText(
        labels.sections.map((label, i) => `${label}${[1, 1, 2, 2, 1][i]}`),
      );
      const sections = inbox.locator("section.inboxsec");
      for (const section of await sections.all())
        await expect(section.locator(".inboxsec__tasktoggle")).toHaveAttribute("aria-expanded", "true");
      const done = inbox.getByRole("region", { name: labels.sections[3], exact: true });
      const toggle = done.getByRole("button", { name: `${labels.sections[3]} 2`, exact: true });
      await toggle.focus();
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(done.locator(".taskbundle").first()).not.toBeVisible();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(inbox.locator(".taskbundle > .threadrow-wrap")).toHaveCount(7);
      const x = await inbox
        .locator(".taskbundle > .threadrow-wrap")
        .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().x));
      expect(x.length).toBe(7);
      expect(new Set(x).size).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: info.outputPath(`tasks-${width}-${lang}.png`), fullPage: true });
      await toggle.click();
      await page.evaluate((thread) => {
        location.hash = `thread=${thread}`;
      }, work["Inventory done"]);
      if (width < 600) await page.getByRole("button", { name: labels.back, exact: true }).first().click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(done.locator(".taskbundle").filter({ hasText: "Inventory done" }).first()).toBeVisible();
      await inbox.getByRole("radio", { name: /^Chats/ }).click();
      await expect(inbox.locator(".threadrow", { hasText: "Inventory external session" })).toHaveCount(0);
      await inbox.getByRole("radio", { name: labels.tasks }).click();
      const pending = inbox.locator(".taskbundle", { hasText: "Inventory pending" });
      await expect(pending).toHaveCount(1);
      await pending.locator(".inboxtask").click();
      await expect(page).toHaveURL(new RegExp(`thread=${code.id}`));
      if (width < 600) {
        await page
          .getByRole("button", { name: lang === "es" ? "Volver al chat" : "Back to the chat", exact: true })
          .click();
        await page.getByRole("button", { name: labels.back, exact: true }).click();
      }
      await inbox.getByRole("button", { name: labels.search, exact: true }).click();
      await inbox.getByRole("searchbox").fill("Inventory pending");
      await expect(inbox.locator(".inboxsec__heading")).toHaveText([`${labels.sections[2]}1`]);
      await inbox.getByRole("searchbox").fill("No matching inventory");
      await expect(inbox.locator(".inboxsec__heading")).toHaveCount(0);
      await expect(inbox.locator(".apx-empty__title")).toHaveText(lang === "es" ? "Sin resultados" : "No results");
      await page.screenshot({ path: info.outputPath(`tasks-empty-${width}-${lang}.png`), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await page.goto("about:blank");
      await env.core.close();
      await env.cleanup();
    }
  });
}
