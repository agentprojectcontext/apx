import type { ActivityReviewStatus } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

for (const language of ["en", "es"] as const) {
  for (const width of [1280, 390]) {
    test(`activity review saves, preserves details when disabled and recovers from errors (${language}, ${width})`, async ({
      page,
    }, info) => {
      await rpc("setup.finish");
      await rpc("activity_review.configure", { enabled: true, frequency: "daily", extra_details: "" });
      await page.setViewportSize({ width, height: width === 390 ? 640 : 900 });
      await page.addInitScript((language) => localStorage.setItem("apx.prefs", JSON.stringify({ language })), language);
      const en = language === "en";
      const title = en ? "Review and improvements" : "Revisión y mejoras";
      const details = en ? "Extra details" : "Detalles extra";
      const save = en ? "Save changes" : "Guardar cambios";
      const enabled = en ? "Review activity" : "Revisar actividad";
      const weekly = en ? "Weekly" : "Semanal";
      const saved = en ? "Changes saved." : "Cambios guardados.";
      const reviewChunks: string[] = [];
      page.on("request", (request) => {
        if (/\/activity-review-(?:en|es)-[^/]+\.js(?:\?|$)/.test(request.url())) reviewChunks.push(request.url());
      });
      await open(page);
      await page.getByRole("button", { name: en ? /^Account/ : /^Cuenta/ }).click();
      await page.getByRole("menuitem", { name: en ? /^Settings(?! wizard)/ : /^Configuración(?! inicial)/ }).click();
      const navItem = page
        .getByRole("dialog")
        .getByRole("button", { name: en ? "Activity review" : title, exact: true });
      expect(reviewChunks).toEqual([]);
      await navItem.click();
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      expect(reviewChunks).toHaveLength(1);
      expect(reviewChunks[0]).toContain(`/activity-review-${language}-`);
      const navLabel = navItem.locator(".apx-nav__label");
      expect(await navLabel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      const input = page.getByRole("textbox", { name: details });
      await expect(input).toHaveValue("");
      await expect(page.getByRole("switch", { name: enabled })).toBeChecked();
      await page.screenshot({ path: info.outputPath("empty.png"), fullPage: true });
      if (width === 390) {
        const content = page.locator(".config__content");
        await page.screenshot({ path: info.outputPath("before-scroll.png") });
        await content.hover();
        await page.mouse.wheel(0, 600);
        await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await expect(page.getByRole("button", { name: save, exact: true })).toBeInViewport();
        expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath("after-scroll.png") });
      }
      await input.fill("Focus on clearer acceptance criteria");
      await page.getByRole("radio", { name: weekly, exact: true }).click();
      await page.getByRole("button", { name: save, exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: saved })).toBeVisible();
      const settings = (await rpc<ActivityReviewStatus>("activity_review.settings")).settings;
      expect(settings).toEqual({
        enabled: true,
        frequency: "weekly",
        extra_details: "Focus on clearer acceptance criteria",
      });
      await page.screenshot({ path: info.outputPath("filled.png"), fullPage: true });
      await page.getByRole("switch", { name: enabled }).click();
      await expect(input).toBeDisabled();
      await expect(page.getByRole("radio", { name: weekly, exact: true })).toBeDisabled();
      await page.getByRole("button", { name: save, exact: true }).click();
      await expect
        .poll(async () => (await rpc<ActivityReviewStatus>("activity_review.settings")).settings.enabled)
        .toBe(false);
      await page.screenshot({ path: info.outputPath("disabled.png"), fullPage: true });
      await page.getByRole("switch", { name: enabled }).click();
      await input.fill("Keep unsaved details after a failed save");
      await page.route("**/rpc/activity_review.configure", (route) =>
        route.fulfill({ json: { ok: false, error: { code: "INTERNAL", message: "Fixture save failed" } } }),
      );
      await page.getByRole("button", { name: save, exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(en ? "Couldn’t save" : "No se pudieron guardar");
      await expect(input).toHaveValue("Keep unsaved details after a failed save");
      await page.screenshot({ path: info.outputPath("save-error.png"), fullPage: true });
      await page.unroute("**/rpc/activity_review.configure");
      await rpc("activity_review.configure", { extra_details: "Changed on another device" });
      // Preserve the real conflict body without Chromium's expected HTTP-status console noise.
      await page.route("**/rpc/activity_review.configure", async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(409);
        await route.fulfill({ response, status: 200 });
      });
      await page.getByRole("button", { name: save, exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(en ? "changed elsewhere" : "cambió en otro lugar");
      await page.screenshot({ path: info.outputPath("conflict.png"), fullPage: true });
      await page
        .getByRole("button", { name: en ? "Reload settings" : "Volver a cargar configuración", exact: true })
        .click();
      await expect(input).toHaveValue("Changed on another device");
      await expect(page.getByRole("switch", { name: enabled })).not.toBeChecked();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(input).toBeDisabled();
      await page.screenshot({ path: info.outputPath("conflict-reloaded.png"), fullPage: true });
    });
  }
}
