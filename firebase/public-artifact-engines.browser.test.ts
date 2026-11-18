import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { expect, firefox, webkit } from "@playwright/test";
import { publicArtifactCode, publicArtifactCopy } from "../apps/core/src/domain/public-artifact-copy.ts";
import { createPublicArtifactCloud } from "../apps/core/src/public-artifacts/firestore.ts";
import { withKit } from "../apps/core/src/surface-kit.ts";
import { browserCloud } from "./browser-cloud.ts";

const host = process.env.FIRESTORE_EMULATOR_HOST;
const viewer = process.env.APX_ARTIFACT_VIEWER_URL;
if (!host || !/^127\.0\.0\.1:\d+$/.test(host) || viewer !== "http://127.0.0.1:7497")
  throw new Error("Run these browser engines through pnpm test:firebase and the demo Hosting emulator");

for (const [engine, width] of [
  [firefox, 1280],
  [webkit, 390],
] as const) {
  test(`${engine.name()} previews, downloads and revokes an opaque public copy without credentialless at ${width}px`, async () => {
    const transport = browserCloud();
    const cloud = createPublicArtifactCloud({ project: "demo-apx-artifacts", fetch: transport.fetch });
    const session = { uid: transport.uid, idToken: transport.token };
    const copy = publicArtifactCopy(
      {
        name: "orders",
        title: "Orders",
        app: false,
        version: 1,
        state: { filter: "Open orders", private: "Not shared" },
        html: withKit(
          `<script src="/_apx/kit@1.js"></script><main class="ax-page"><h1 class="ax-title">Shared orders</h1><p id="filter" class="ax-lede"></p><p id="isolation" hidden></p></main><script>document.getElementById('filter').textContent=APX.state.get('filter','Missing');let parentBlocked=false,cookieBlocked=false;try{parent.document.body}catch{parentBlocked=true}try{document.cookie}catch{cookieBlocked=true}document.getElementById('isolation').textContent=JSON.stringify({parentBlocked,cookieBlocked,origin:self.origin})</script>`,
        ),
      },
      ["filter"],
    );
    const code = publicArtifactCode();
    await cloud.publish(session, code, copy);
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, locale: "en-US", acceptDownloads: true });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${viewer}/${code}`);
      await expect(page.frameLocator("iframe").getByRole("heading", { name: "Shared orders" })).toBeVisible();
      await expect(page.frameLocator("iframe").locator("#filter")).toHaveText("Open orders");
      await expect(page.frameLocator("iframe").locator("#isolation")).toHaveText(
        '{"parentBlocked":true,"cookieBlocked":true,"origin":"null"}',
      );
      if (process.env.APX_ARTIFACT_EVIDENCE)
        await page.screenshot({
          path: path.join(process.env.APX_ARTIFACT_EVIDENCE, `viewer-${engine.name()}-${width}.png`),
        });
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download file", exact: true }).click();
      const download = await downloaded;
      const stream = await download.createReadStream();
      const bytes: Buffer[] = [];
      for await (const chunk of stream) bytes.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(bytes).toString("utf8"), copy.json);
      const current = await cloud.inspect(session, code);
      await cloud.revoke(session, code, current.updateTime);
      await expect(page.locator("iframe")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "This copy isn't available", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Download file", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open in APX", exact: true })).toHaveCount(0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
}
