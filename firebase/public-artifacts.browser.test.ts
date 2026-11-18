import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { type Browser, chromium, expect, type Request } from "@playwright/test";
import { publicArtifactCode, publicArtifactCopy } from "../apps/core/src/domain/public-artifact-copy.ts";
import { createPublicArtifactCloud } from "../apps/core/src/public-artifacts/firestore.ts";
import { withKit } from "../apps/core/src/surface-kit.ts";
import { tempDir } from "../apps/core/src/testkit/platform.ts";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const viewer = process.env.APX_ARTIFACT_VIEWER_URL;
if (!emulator || !/^127\.0\.0\.1:\d+$/.test(emulator) || !viewer)
  throw new Error("Start the demo emulator and local artifact viewer first");
const url = new URL(viewer);
if (url.origin !== "http://127.0.0.1:7497")
  throw new Error("Run the built viewer on the Firebase Hosting emulator at http://127.0.0.1:7497, not Vite");
const project = "demo-apx-artifacts";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const session = {
  uid: "browser",
  idToken: `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "browser", user_id: "browser", aud: project, iss: `https://securetoken.google.com/${project}`, iat: 1, exp: 4102444800, firebase: { sign_in_provider: "google.com", identities: {} } })}.`,
};
const cloud = createPublicArtifactCloud({ project, origin: `http://${emulator}` });

function fixture(spy: string) {
  const html = withKit(
    `<script src="/_apx/kit@1.js"></script><main class="ax-page"><header class="ax-header"><span class="ax-eyebrow">A little time outdoors</span><h1 class="ax-title">Our next weekend</h1><p class="ax-lede">A shared plan, ready to make your own.</p></header><section class="ax-card"><span class="ax-badge ax-badge--brand">Saturday</span><h2 id="destination" class="ax-h2"></h2><p>Take the scenic route, stop for coffee and leave the afternoon free.</p></section><small id="parent-check" hidden></small><small id="network-check" hidden></small></main><script>document.getElementById('destination').textContent=APX.state.get('destination','Missing');try{parent.document.body;document.getElementById('parent-check').textContent='Parent reachable';}catch{document.getElementById('parent-check').textContent='Parent blocked';}fetch('${spy}').then(()=>document.getElementById('network-check').textContent='Network reachable').catch(()=>document.getElementById('network-check').textContent='Network blocked');</script>`,
  );
  return publicArtifactCopy(
    {
      name: "weekend-plan",
      title: "Weekend plan",
      version: 1,
      app: false,
      html,
      state: { destination: "Mountains", private: "never uploaded" },
    },
    ["destination"],
  );
}

test("Hosting serves disjoint wrapper/runner policies and immutable hashed assets", async () => {
  for (const pathname of ["/", "/index.html", "/abcd1234"]) {
    const response = await fetch(`${url.origin}${pathname}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(csp.includes(","), false, "only one CSP policy must apply");
  }
  for (const pathname of ["/nested/abcd1234", "/assets/not-a-built-file.js"]) {
    const response = await fetch(`${url.origin}${pathname}`);
    assert.equal(response.status, 404, "only root-level copy links may fall back to the wrapper");
  }
  const runner = await fetch(`${url.origin}/runner.html`);
  assert.equal(runner.headers.get("cache-control"), "no-store");
  const csp = runner.headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /script-src 'unsafe-inline'/);
  assert.match(csp, /sandbox allow-scripts/);
  assert.doesNotMatch(csp, /frame-ancestors 'none'|script-src 'self'|,/);
  const html = await (await fetch(`${url.origin}/index.html`)).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map((match) => match[1]);
  assert.ok(assets.length >= 2);
  for (const asset of assets) {
    const response = await fetch(`${url.origin}${asset}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  }
});

test("the viewer isolates credentials and network, downloads exact approved bytes and removes live revoked copies", async () => {
  const dir = tempDir("apx-artifact-browser-");
  let browser: Browser | undefined;
  let networkRequests = 0;
  const spy = http.createServer((_req, response) => {
    networkRequests++;
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.end("unexpected");
  });
  try {
    await new Promise<void>((resolve) => spy.listen(0, "127.0.0.1", resolve));
    const address = spy.address();
    assert.ok(address && typeof address !== "string");
    const copy = fixture(`http://127.0.0.1:${address.port}/rpc`);
    const code = publicArtifactCode();
    await cloud.publish(session, code, copy);
    browser = await chromium.launch({ headless: true, downloadsPath: dir.path });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
      acceptDownloads: true,
    });
    await context.addCookies([{ name: "private-test-cookie", value: "acme-session", url: viewer }]);
    const page = await context.newPage();
    const runners: Request[] = [];
    const wrappers: Request[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/runner.html")) runners.push(request);
      if (request.url() === `${url.origin}/${code}`) wrappers.push(request);
    });
    await page.goto(`${url.origin}/${code}`);
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#destination")).toHaveText("Mountains", { timeout: 20_000 });
    await expect(frame.locator("#parent-check")).toHaveText("Parent blocked");
    await expect(frame.locator("#network-check")).toHaveText("Network blocked");
    assert.equal(networkRequests, 0);
    assert.ok(wrappers[0] && runners[0]);
    assert.match((await wrappers[0].allHeaders()).cookie ?? "", /acme-session/);
    assert.equal((await runners[0].allHeaders()).cookie, undefined);
    const event = page.waitForEvent("download", { timeout: 20_000 });
    await page.getByRole("button", { name: "Download file", exact: true }).click();
    const download = await event;
    assert.equal(download.suggestedFilename(), "weekend-plan.apxart");
    const file = await download.path();
    assert.ok(file);
    assert.equal(await fs.readFile(file, "utf8"), copy.json);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const language of ["en", "es"]) {
        if (language === "es") await page.getByRole("button", { name: "Español", exact: true }).click();
        if (language === "en" && (await page.getByRole("button", { name: "English", exact: true }).count()))
          await page.getByRole("button", { name: "English", exact: true }).click();
        const output = process.env.APX_ARTIFACT_EVIDENCE ?? dir.path;
        await page.screenshot({ path: path.join(output, `viewer-${width}-${language}.png`), fullPage: true });
      }
    }
    await page.getByRole("button", { name: "English", exact: true }).click();
    const previous = await cloud.inspect(session, code);
    await cloud.revoke(session, code, previous.updateTime);
    await expect(page.locator("iframe")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "This copy isn't available", exact: true })).toBeVisible();
    assert.equal(await page.getByRole("button", { name: "Open in APX", exact: true }).count(), 0);
  } finally {
    await browser?.close();
    if (spy.listening)
      await new Promise<void>((resolve, reject) => spy.close((error) => (error ? reject(error) : resolve())));
    await dir.remove();
  }
});

test("browsers without credentialless still execute an opaque sandbox preview and download the verified copy", async () => {
  const dir = tempDir("apx-artifact-browser-");
  let browser: Browser | undefined;
  try {
    const code = publicArtifactCode();
    const copy = publicArtifactCopy({
      name: "orders",
      title: "Orders",
      html: "<h1>Orders</h1><p id='isolation'></p><script>try {parent.document.body; document.getElementById('isolation').textContent='reachable'} catch {document.getElementById('isolation').textContent='blocked'}</script>",
      version: 1,
      app: false,
    });
    await cloud.publish(session, code, copy);
    browser = await chromium.launch({ headless: true, downloadsPath: dir.path });
    const context = await browser.newContext({ locale: "en-US", acceptDownloads: true });
    await context.addCookies([{ name: "artifact-test-cookie", value: "demo-cookie", url: viewer }]);
    await context.addInitScript(() => {
      Reflect.deleteProperty(HTMLIFrameElement.prototype, "credentialless");
      const setAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (name, value) {
        if (name !== "credentialless") setAttribute.call(this, name, value);
      };
    });
    const page = await context.newPage();
    const runnerRequest = page.waitForRequest((request) => request.url().endsWith("/runner.html"));
    await page.goto(`${url.origin}/${code}`);
    assert.match((await (await runnerRequest).allHeaders()).cookie ?? "", /demo-cookie/);
    const frame = page.frameLocator("iframe");
    await expect(frame.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
    await expect(frame.locator("#isolation")).toHaveText("blocked");
    assert.equal(await frame.locator("body").evaluate(() => window.origin), "null");
    assert.equal(
      await frame.locator("body").evaluate(() => {
        try {
          return document.cookie;
        } catch {
          return "blocked";
        }
      }),
      "blocked",
    );
    assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
    const event = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download file", exact: true }).click();
    const download = await event;
    const file = await download.path();
    assert.ok(file);
    assert.equal(await fs.readFile(file, "utf8"), copy.json);
    await page.getByRole("button", { name: "Español", exact: true }).click();
    await expect(frame.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir en APX", exact: true })).toBeVisible();
    await cloud.revoke(session, code, (await cloud.inspect(session, code)).updateTime);
  } finally {
    await browser?.close();
    await dir.remove();
  }
});
