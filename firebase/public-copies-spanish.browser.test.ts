import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { testConfig } from "../apps/core/src/config.ts";
import { APX_ACCOUNT_SESSION } from "../apps/core/src/secret-names.ts";
import { createCore } from "../apps/core/src/server.ts";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { ApxClient } from "../packages/protocol/src/client.ts";
import { browserCloud } from "./browser-cloud.ts";

for (const width of [1280, 390]) {
  test(`Spanish public-copy review and publication at ${width}px`, async () => {
    const home = tempDir("apx-public-spanish-");
    const cloud = browserCloud(`spanish-${width}`);
    const core = await createCore(
      testConfig({
        home: home.path,
        webDist: path.resolve(import.meta.dirname, "../apps/web/dist"),
        accountClient: JSON.stringify({ project: "demo-apx-artifacts", apiKey: "public-test-key" }),
      }),
      { quiet: true, publicArtifactFetch: cloud.fetch },
    );
    const browser = await chromium.launch({ headless: true });
    try {
      core.secrets.set(
        APX_ACCOUNT_SESSION,
        JSON.stringify({
          uid: cloud.uid,
          idToken: cloud.token,
          refreshToken: "private-refresh-token",
          expires: Number.MAX_SAFE_INTEGER,
          profile: { id: "abcd1234", name: "Acme", photo: "", handle: "" },
        }),
      );
      const client = new ApxClient({ url: core.url });
      await client.call("setup.finish", {});
      const source = await client.call("surfaces.show", {
        name: "orders",
        title: "Orders",
        app: true,
        html: "<h1>Orders</h1>",
      });
      await client.call("surfaces.set_state", { surface: source.id, patch: { Filters: { region: "South" } } });
      const page = await browser.newPage({ locale: "es-AR", viewport: { width, height: 900 } });
      await page.goto(`${core.url}/#app=${source.id}`);
      await page.getByRole("button", { name: "Saltear", exact: true }).click();
      await page.getByRole("button", { name: "Compartir", exact: true }).click();
      await page.getByRole("menuitem", { name: "Publicar copia…", exact: true }).click();
      await expect(page.getByRole("checkbox", { name: "Filters", exact: true })).not.toBeChecked();
      await page.getByRole("checkbox", { name: "Filters", exact: true }).check();
      await page.getByRole("button", { name: "Revisar copia", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Revisá esta copia exacta" });
      await expect(dialog).toContainText("Publicando como Acme");
      await expect(
        page
          .frameLocator('iframe[title="Vista previa de la página publicada"]')
          .frameLocator("iframe")
          .getByRole("heading", { name: "Orders" }),
      ).toBeVisible();
      await expect(dialog.locator("pre").last()).toContainText('"region": "South"');
      assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth), false);
      if (process.env.PUBLIC_COPY_EVIDENCE)
        await page.screenshot({ path: path.join(process.env.PUBLIC_COPY_EVIDENCE, `panel-review-${width}-es.png`) });
      assert.equal(cloud.commits(), 0);
      await page.getByRole("button", { name: "Publicar copia", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      assert.equal(cloud.commits(), 1);
    } finally {
      await browser.close();
      await core.close();
      await home.remove();
    }
  });
}
