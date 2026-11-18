import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { type Browser, chromium, expect } from "@playwright/test";
import { publicPreviewDocument } from "../packages/surfaces/src/public-preview.ts";

test("a private copy preview cannot reach the host, send network requests or navigate itself out of its sandbox", async () => {
  let browser: Browser | undefined;
  let requests = 0;
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url?.startsWith("/exfil")) requests++;
    response.end("<!doctype html><title>Private host</title><h1>Private host</h1>");
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies([{ name: "private-session", value: "private-cookie", url: origin }]);
    const page = await context.newPage();
    await page.goto(origin);
    const dangerous = '</script><script>fetch("/exfil")</script>';
    const html = `<h1 id="value"></h1><p id="parent"></p><p id="network"></p><script>
      document.getElementById('value').textContent=window.apx.state.get('selected');
      try{parent.document.body;document.getElementById('parent').textContent='reachable'}catch{document.getElementById('parent').textContent='blocked'}
      fetch('${origin}/exfil',{method:'POST',body:'not-approved'}).then(()=>document.getElementById('network').textContent='reachable').catch(()=>document.getElementById('network').textContent='blocked');
      const image=new Image();image.src='${origin}/exfil-image';document.body.append(image);
    </script>`;
    await page.evaluate(
      (srcdoc) => {
        const frame = document.createElement("iframe");
        frame.setAttribute("sandbox", "allow-scripts");
        frame.srcdoc = srcdoc;
        document.body.append(frame);
      },
      publicPreviewDocument(html, { selected: dangerous }),
    );
    const inner = page.frameLocator("iframe").frameLocator("iframe");
    await expect(inner.locator("#value")).toHaveText(dangerous);
    await expect(inner.locator("#parent")).toHaveText("blocked");
    await expect(inner.locator("#network")).toHaveText("blocked");
    assert.equal(await inner.locator("body").evaluate(() => window.origin), "null");
    assert.equal(
      await inner.locator("body").evaluate(() => {
        try {
          return document.cookie;
        } catch {
          return "blocked";
        }
      }),
      "blocked",
    );
    assert.equal(requests, 0);
    const blocked = page.waitForEvent("console", {
      predicate: (message) => message.text().includes("frame-src blob:") && message.text().includes("blocked"),
    });
    await inner.locator("body").evaluate((_element, url) => {
      location.href = url;
    }, `${origin}/exfil-navigation`);
    await blocked;
    assert.equal(requests, 0);
    await expect(page.locator("body > h1")).toHaveText("Private host");
  } finally {
    await browser?.close();
    if (server.listening)
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
