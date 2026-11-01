import type { Message, Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

for (const language of ["en", "es"] as const) {
  test(`external read-only sessions distinguish reported and requested models (${language})`, async ({
    page,
  }, info) => {
    await rpc("setup.finish");
    const thread = await rpc<Thread>("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      title: "Session model",
    });
    const external: Thread = {
      ...thread,
      kind: "a2a",
      parent_id: "home",
      engine: "claude",
      cwd: "~/work/acme",
      write: "auto",
      model_choice: { model: "claude/requested-model#high", router: false },
    };
    const messages: Message[] = [undefined, "claude/default", "claude/reported-a", "claude/reported-b"].map(
      (model, i) => ({
        id: `session-model-${i}`,
        thread_id: thread.id,
        seq: i + 1,
        author: { kind: "agent", id: "superagent" },
        parts: [{ type: "text", text: `Response ${i + 1}` }],
        created_at: new Date(0).toISOString(),
        ...(model ? { model } : {}),
      }),
    );
    await page.addInitScript((lang) => localStorage.setItem("apx.prefs", JSON.stringify({ language: lang })), language);
    await page.route("**/rpc/models.list", async (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            engines: [
              {
                id: "claude",
                label: "Claude Code",
                kind: "harness",
                available: true,
                models: [
                  { id: "reported-a", name: "Reported model A", chat: true },
                  { id: "reported-b", name: "Reported model B", chat: true },
                  { id: "requested-model", name: "Requested model", chat: true, efforts: ["high"] },
                ],
              },
            ],
          },
        },
      }),
    );
    await page.route("**/rpc/threads.get", async (route) => {
      if (route.request().postDataJSON().thread !== thread.id) return route.continue();
      await route.fulfill({ json: { ok: true, result: { thread: external, messages, runs: [] } } });
    });
    await open(page, `#thread=${thread.id}`);
    const unconfirmed = language === "en" ? "Model unconfirmed" : "Modelo sin confirmar";
    await expect(page.locator(".apx-msgmeta").filter({ hasText: unconfirmed })).toHaveCount(2);
    await expect(page.locator(".apx-msgmeta").filter({ hasText: "Reported model A" })).toHaveCount(1);
    await expect(page.locator(".apx-msgmeta").filter({ hasText: "Reported model B" })).toHaveCount(1);
    await expect(page.locator(".apx-msgmeta").filter({ hasText: "Requested model" })).toHaveCount(0);
    await expect(page.locator(".chat__modelrequest")).toContainText(language === "en" ? "Requested:" : "Solicitado:");
    await expect(page.locator(".chat__modelrequest")).toContainText("Requested model");
    await expect(page.locator(".chat__modelrequest")).toContainText(language === "en" ? "High" : "Alto");
    await expect(page.locator(".apx-msgmeta").filter({ hasText: /High|Alto/ })).toHaveCount(0);
    await expect(page.locator(".apx-composer textarea")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`models-${language}-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText(unconfirmed).first()).toBeVisible();
    const headerBox = await page.locator(".chat__header").boundingBox();
    const requestBox = await page.locator(".chat__modelrequest").boundingBox();
    expect(headerBox).not.toBeNull();
    expect(requestBox).not.toBeNull();
    expect((requestBox?.y ?? 0) + (requestBox?.height ?? 0)).toBeLessThanOrEqual(
      (headerBox?.y ?? 0) + (headerBox?.height ?? 0),
    );
    await page.screenshot({ path: info.outputPath(`models-${language}-phone.png`), fullPage: true });
    await page.reload();
    await expect(page.locator(".apx-msgmeta").filter({ hasText: "Reported model A" })).toHaveCount(1);
    await expect(page.locator(".apx-msgmeta").filter({ hasText: "Reported model B" })).toHaveCount(1);
    await page.unrouteAll({ behavior: "wait" });
    await rpc("threads.delete", { thread: thread.id });
  });
}
