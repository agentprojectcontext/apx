import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { withPanel } from "./testkit.ts";

test("only the APX extension and same-origin pages can frame the panel", async () => {
  await withPanel("en", false, async ({ core, page, frame }) => {
    await expect(frame.locator(".pair")).toBeVisible();
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<iframe src="${core.url}/?quick" title="panel"></iframe>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const violation = page.waitForEvent("console", {
        predicate: (message) => message.text().includes("frame-ancestors"),
      });
      await page.goto(`http://127.0.0.1:${address.port}/`);
      assert.match((await violation).text(), /frame-ancestors/);
      await expect(page.frameLocator('iframe[title="panel"]').locator(".pair")).toHaveCount(0);
      await page.goto(`${core.url}/?quick`);
      await expect(page.locator(".pair")).toBeVisible();
      await page.evaluate(() => {
        const child = document.createElement("iframe");
        child.title = "same-origin";
        child.src = "/?quick";
        document.body.appendChild(child);
      });
      await expect(page.frameLocator('iframe[title="same-origin"]').locator(".pair")).toBeVisible();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
