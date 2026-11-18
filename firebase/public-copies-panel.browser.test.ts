import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { testConfig } from "../apps/core/src/config.ts";
import { APX_ACCOUNT_SESSION } from "../apps/core/src/secret-names.ts";
import { createCore } from "../apps/core/src/server.ts";
import { removeDir, tempDir } from "../apps/core/src/testkit/platform.ts";
import { ApxClient } from "../packages/protocol/src/client.ts";
import { browserCloud } from "./browser-cloud.ts";

for (const width of [1280, 390]) {
  test(`public-copy selection, exact review, invalidation and confirmation in the built panel at ${width}px`, async () => {
    const home = tempDir("apx-public-panel-").path;
    const cloud = browserCloud(`panel-${width}`);
    const core = await createCore(
      testConfig({
        home,
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
        html: '<h1>Orders</h1><p id="chosen"></p><script>document.getElementById("chosen").textContent=JSON.stringify(window.apx.state.all())</script>',
      });
      await client.call("surfaces.set_state", {
        surface: source.id,
        patch: { Filters: { nested: [1, { region: "South" }] }, PrivateNotes: "Not selected" },
      });
      const page = await browser.newPage({ locale: "en-US", viewport: { width, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${core.url}/#app=${source.id}`);
      await page.getByRole("button", { name: "Skip", exact: true }).click();
      const start = async () => {
        await page.getByRole("button", { name: "Share", exact: true }).click();
        await page.getByRole("menuitem", { name: "Publish copy…" }).click();
        await expect(page.getByRole("checkbox", { name: "Filters", exact: true })).not.toBeChecked();
        await expect(page.getByRole("checkbox", { name: "PrivateNotes", exact: true })).not.toBeChecked();
      };
      for (let i = 0; i < 20; i++) {
        const abandoned = await client.call("surfaces.show", {
          name: `cancelled-${i}`,
          title: `Cancelled review ${i}`,
          html: "<h1>Orders</h1>",
          app: true,
        });
        await client.call("surfaces.set_state", {
          surface: abandoned.id,
          patch: { Filters: {}, PrivateNotes: "Not selected" },
        });
        await page.goto(`${core.url}/#app=${abandoned.id}`);
        await start();
        await page.getByRole("button", { name: "Review copy", exact: true }).click();
        const cancelled = page.getByRole("dialog", { name: "Review this exact copy" });
        await expect(cancelled.getByRole("button", { name: "Publish copy", exact: true })).toBeEnabled();
        if (i % 2) await page.keyboard.press("Escape");
        else await cancelled.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(cancelled).toHaveCount(0);
        await expect
          .poll(
            () =>
              (JSON.parse(core.store.settings.get("public_artifact_drafts") ?? "[]") as { done?: unknown }[]).filter(
                (draft) => !draft.done,
              ).length,
          )
          .toBe(0);
      }
      assert.equal(cloud.commits(), 0);
      await page.goto(`${core.url}/#app=${source.id}`);
      await start();
      await page.getByText("View contents", { exact: true }).first().click();
      await expect(page.getByRole("dialog").locator("pre").first()).toContainText('"region": "South"');
      await page.getByRole("checkbox", { name: "Filters", exact: true }).check();
      await page.getByRole("button", { name: "Review copy", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Review this exact copy" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Publishing as Acme");
      assert.equal(cloud.commits(), 0);
      const inner = page.frameLocator('iframe[title="Published page preview"]').frameLocator("iframe");
      await expect(inner.getByRole("heading", { name: "Orders" })).toBeVisible();
      await expect(inner.locator("#chosen")).toHaveText('{"Filters":{"nested":[1,{"region":"South"}]}}');
      await expect(dialog.locator("pre").last()).not.toContainText("Not selected");
      assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth), false);
      if (process.env.PUBLIC_COPY_EVIDENCE)
        await page.screenshot({ path: path.join(process.env.PUBLIC_COPY_EVIDENCE, `panel-review-${width}-en.png`) });
      await client.call("surfaces.set_state", { surface: source.id, patch: { Filters: { changed: true } } });
      await page.getByRole("button", { name: "Publish copy", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("review is no longer current");
      await expect(dialog.getByRole("button", { name: "Publish copy", exact: true })).toBeDisabled();
      assert.equal(cloud.commits(), 0);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await start();
      await page.getByRole("button", { name: "Review copy", exact: true }).click();
      await page.getByRole("button", { name: "Publish copy", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      assert.equal(cloud.commits(), 1);
      assert.equal((await client.call("surfaces.public_list", {})).count, 1);
      await page.keyboard.press("ControlOrMeta+k");
      await page
        .getByRole("textbox", { name: "Search", exact: true })
        .or(page.getByRole("combobox", { name: "Search", exact: true }))
        .fill("account");
      await page.getByRole("option", { name: /Account/ }).click();
      const published = page.getByRole("region", { name: "Published copies", exact: true });
      await expect(published.getByText("Orders", { exact: true })).toBeVisible();
      await client.call("surfaces.show", {
        name: "orders",
        title: "Orders",
        app: true,
        html: "<h1>Updated orders</h1>",
      });
      await published.getByRole("button", { name: "Manage", exact: true }).click();
      await page.getByRole("combobox", { name: "Choose a local artifact", exact: true }).click();
      await page.getByRole("option", { name: "Orders", exact: true }).click();
      await page.getByRole("button", { name: "Update copy…", exact: true }).click();
      await expect(page.getByRole("checkbox", { name: "Filters", exact: true })).not.toBeChecked();
      await page.getByRole("button", { name: "Review copy", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Review this exact copy" })).toContainText(
        "The link stays the same",
      );
      await page.getByRole("button", { name: "Update copy", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Review this exact copy" })).toHaveCount(0);
      assert.equal(cloud.commits(), 2);
      await client.call("surfaces.remove", { surface: source.id });
      await published.getByRole("button", { name: "Manage", exact: true }).click();
      await page.getByRole("button", { name: "Stop publishing…", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Review this exact copy" })).toContainText(
        "Files people already downloaded will not be removed",
      );
      await page.getByRole("button", { name: "Stop publishing", exact: true }).click();
      await expect(published).toContainText("You have no published copies");
      assert.equal(cloud.commits(), 3);
      assert.equal((await client.call("surfaces.public_list", {})).count, 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await core.close();
      await removeDir(home);
    }
  });
}
