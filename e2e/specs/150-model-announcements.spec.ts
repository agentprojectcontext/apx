import type { ModelAnnouncement } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test, world } from "./kit.ts";

test.use({ cornerCards: true, compactSidebar: true });

async function addLaunchProvider(id: string) {
  const { llm } = await world.info();
  await rpc("providers.set", {
    id,
    provider: {
      label: "Launch models",
      preset: "openai-compatible",
      transport: "openai-chat",
      base_url: llm,
      needs_key: false,
      enabled: true,
      models: ["gemini-4-hydrogen", "claude-fable-5-2"],
    },
  });
}

for (const language of ["es", "en"] as const) {
  test(`official launch cards: ${language}, review, dismiss, reload and no model changes`, async ({ page }) => {
    await rpc("setup.finish");
    const before = await rpc("models.config");
    const calls = await world.llmCalls();
    await addLaunchProvider("launch-primary");
    await addLaunchProvider("launch-secondary");
    try {
      const { announcements } = await rpc<{ announcements: ModelAnnouncement[] }>("models.list", { refresh: true });
      const hydrogen = announcements.find((a) => a.model === "gemini-4-hydrogen");
      expect(hydrogen?.integration).toBe("pending");
      expect(hydrogen?.engines).toEqual(["launch-primary", "launch-secondary"]);
      await page.addInitScript((lang) => {
        const prefs = JSON.parse(localStorage.getItem("apx.prefs") ?? "{}");
        localStorage.setItem("apx.prefs", JSON.stringify({ ...prefs, language: lang }));
      }, language);
      await open(page);
      const card = page.locator('[data-card="model:gemini-4-hydrogen-2026-11-12"]');
      await expect(card.getByText("Gemini 4 Hydrogen", { exact: true })).toBeVisible();
      await expect(card).toContainText(language === "es" ? "Todavía no se probó en APX" : "Not yet tested in APX");
      await expect(card.getByRole("link")).toHaveAttribute("href", /blog.google\/.*introducing-gemini-4-hydrogen\//);
      await page.screenshot({ path: test.info().outputPath(`launch-${language}-desktop.png`) });
      await card.getByRole("button", { name: language === "es" ? "Revisar modelos" : "Review models" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("dialog")).toContainText("Launch models");
      await page.keyboard.press("Escape");
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: language === "es" ? "Cerrar" : "Close", exact: true }).click();
      await expect(page.locator('[data-card="model:claude-fable-5-2-2026-11-09"]')).toBeVisible();
      await page.reload();
      await expect(card).toHaveCount(0);
      await expect(page.locator('[data-card="model:claude-fable-5-2-2026-11-09"]')).toContainText("30");
      await page.setViewportSize({ width: 390, height: 844 });
      const phoneCard = page.locator('[data-card="model:claude-fable-5-2-2026-11-09"]');
      await expect(phoneCard).toBeVisible();
      await expect(phoneCard.getByRole("link")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`launch-${language}-phone.png`) });
      expect(await rpc("models.config")).toEqual(before);
      expect(await world.llmCalls()).toBe(calls);
    } finally {
      await rpc("providers.set", { id: "launch-primary", provider: null });
      await rpc("providers.set", { id: "launch-secondary", provider: null });
    }
  });
}
