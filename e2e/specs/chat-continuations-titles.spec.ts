import path from "node:path";
import { fileURLToPath } from "node:url";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

const SHOTS = process.env.SHOTS;
const webDist = fileURLToPath(new URL("../../apps/web/dist", import.meta.url));

for (const language of ["es", "en"] as const) {
  for (const width of [1280, 390]) {
    test(`${language} at ${width}px: real follow-up tool cards name create, list and cancel`, async ({ page }) => {
      let id = "";
      const llm = scriptedLlm((_req, { said, afterTool }) => {
        if (afterTool) return say("Done.");
        if (said.includes("List follow-ups")) return callTool("list", "chat_followup", { action: "list" });
        if (said.includes("Cancel follow-up")) return callTool("cancel", "chat_followup", { action: "cancel", id });
        return callTool("create", "chat_followup", {
          action: "create",
          purpose: "Read the report",
          condition: { kind: "time", at: "2026-10-05T10:10:00Z" },
          expires_at: "2026-10-05T11:00:00Z",
        });
      });
      const env = await startCore({ llm, clock: () => new Date("2026-10-05T10:00:00Z"), webDist });
      try {
        await env.client.call("setup.finish", {});
        await env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
        env.core.store.settings.set("owner_language", language);
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.addInitScript((lang) => {
          if (location.protocol === "http:") localStorage.setItem("apx.prefs", JSON.stringify({ language: lang }));
        }, language);
        await page.goto(`${env.core.url}/#thread=home`);
        const cases = [
          ["create", "Schedule a follow-up", "Programó una continuación", "Scheduled a follow-up"],
          ["list", "List follow-ups", "Revisó las continuaciones", "Looked at follow-ups"],
          ["cancel", "Cancel follow-up", "Canceló una continuación", "Canceled a follow-up"],
        ] as const;
        for (const [index, [action, prompt, spanish, english]] of cases.entries()) {
          await page.getByRole("textbox").fill(prompt);
          await page.getByRole("button", { name: language === "es" ? "Enviar" : "Send", exact: true }).click();
          const card = page.locator(".turn__tools").nth(index);
          await expect(card).toHaveText(/1 (paso|step)/);
          await env.settle("home");
          await card.getByRole("button").click();
          const label = card.locator(".apx-actions__name");
          await expect(label).toHaveText(language === "es" ? spanish : english);
          await expect(label).toBeVisible();
          await expect(label).not.toHaveText(language === "es" ? english : spanish);
          const saved = (await env.client.call("continuations.list", { thread: "home" })).continuations;
          expect(saved).toHaveLength(1);
          id = saved[0]?.id ?? "";
          expect(saved[0]?.state).toBe(action === "cancel" ? "canceled" : "pending");
          await card.scrollIntoViewIfNeeded();
          if (SHOTS)
            await page.screenshot({ path: path.join(SHOTS, `followup-title-${language}-${width}-${action}.png`) });
        }
        await page.reload();
        const cards = page.locator(".turn__tools");
        await expect(cards).toHaveCount(3);
        for (const [index, [, , spanish, english]] of cases.entries()) {
          await cards.nth(index).getByRole("button").click();
          await expect(cards.nth(index).locator(".apx-actions__name")).toHaveText(
            language === "es" ? spanish : english,
          );
        }
      } finally {
        await page.goto("about:blank");
        await env.core.close();
        await env.cleanup();
      }
    });
  }
}
