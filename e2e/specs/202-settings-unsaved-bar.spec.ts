// A Settings screen whose changes wait for Save shows the shared bar at the bottom of the pane: here, the Router.
// Activity review checks the same bar in 118-activity-review.
import type { ModelChoice, RouterConfig } from "../../packages/protocol/src/domain.ts";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

type Models = { default: ModelChoice; router: RouterConfig };

for (const width of [1280, 390])
  test(`the router's changes wait in the bar: discard puts them back, save keeps them (${width})`, async ({
    page,
  }, info) => {
    await rpc("setup.finish");
    const before = await rpc<Models>("models.config");
    try {
      await rpc("models.set_config", { default: { router: true }, router: { chain: ["custom/fake-1"], rules: [] } });
      await page.setViewportSize({ width, height: width === 390 ? 700 : 900 });
      await open(page);
      await openSettings(page);
      await page.getByRole("dialog").getByRole("button", { name: "Router", exact: true }).click();
      const bar = page.locator(".apx-unsaved");
      const removes = page.getByRole("button", { name: "Quitar de la cadena" });
      await expect(removes).toHaveCount(1);
      await expect(bar).toHaveCount(0);

      await page.getByRole("button", { name: "Agregar un modelo" }).click();
      await page.getByRole("option", { name: /fake-2/ }).click();
      await expect(removes).toHaveCount(2);
      await expect(bar).toContainText("Tenés cambios sin guardar.");
      await bar.getByRole("button", { name: "Descartar", exact: true }).click();
      await expect(removes).toHaveCount(1);
      await expect(bar).toHaveCount(0);
      expect((await rpc<Models>("models.config")).router.chain).toEqual(["custom/fake-1"]);

      await page.getByRole("button", { name: "Agregar un modelo" }).click();
      await page.getByRole("option", { name: /fake-2/ }).click();
      await page.getByRole("button", { name: "Agregar regla", exact: true }).click();
      // Long or short, the screen keeps Save in sight at the bottom, and never scrolls sideways.
      const content = page.locator(".config__content");
      await content.evaluate((element) => element.scrollTo(0, 0));
      const save = bar.getByRole("button", { name: "Guardar cambios", exact: true });
      await expect(save).toBeInViewport();
      expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath("router-unsaved.png") });
      await save.click();
      await expect(bar).toHaveCount(0);
      await expect
        .poll(async () => {
          const { router } = await rpc<Models>("models.config");
          return { chain: router.chain, rules: router.rules.length };
        })
        .toEqual({ chain: ["custom/fake-1", "custom/fake-2"], rules: 1 });

      // Saved means saved: opened again, the screen shows it with nothing waiting.
      await page.reload();
      await openSettings(page);
      await page.getByRole("dialog").getByRole("button", { name: "Router", exact: true }).click();
      await expect(removes).toHaveCount(2);
      await expect(bar).toHaveCount(0);
    } finally {
      await rpc("models.set_config", { default: before.default, router: before.router });
    }
  });
