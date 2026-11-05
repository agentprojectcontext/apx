import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const base = process.env.DOCS_TEST_URL ?? "http://127.0.0.1:4321";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const requests = [];
  // Load the real Google tag but intercept collection: transport proof without polluting property reports.
  await context.route(/https:\/\/[^/]*google-analytics\.com\//, async (route) => {
    const request = route.request();
    requests.push({ url: request.url(), body: request.postData() ?? "" });
    await route.abort();
  });
  await page.goto(
    `${base}/?email=private%40example.com&utm_source=youtube&utm_medium=video&utm_campaign=launch#private`,
    { waitUntil: "networkidle" },
  );
  assert.equal(requests.length, 0);
  await page.locator("[data-cookie-accept]").click();
  const names = () =>
    requests
      .flatMap(({ url, body }) => [
        new URL(url).searchParams,
        ...body.split("\n").map((line) => new URLSearchParams(line)),
      ])
      .map((query) => query.get("en"))
      .filter(Boolean);
  await expect.poll(() => names(), { timeout: 20000 }).toContain("page_view");
  await page.evaluate(() => {
    const link = document.querySelector("#download a[data-file]");
    link.href = "https://github.com/agentprojectcontext/apx/releases/download/v2.0.0/apx-win-x64.exe?secret=private";
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    link.click();
  });
  await page.locator("#download [data-copy]:visible").first().click();
  await expect.poll(() => names(), { timeout: 20000 }).toContain("download_click");
  await expect.poll(() => names(), { timeout: 20000 }).toContain("install_copy");
  const payload = JSON.stringify(requests);
  assert.ok(!payload.includes("private"));
  assert.ok(!payload.includes("install.sh"));
  assert.ok(!payload.includes("ep.link_url"));
  assert.equal(names().filter((name) => name === "page_view").length, 1);
  console.log(
    `PASS real Google tag encoded ${[...new Set(names())].join(", ")}; collection intercepted, no property ingestion claimed`,
  );
  requests.length = 0;
  await page.goto(`${base}/?utm_source=private%40example.com&utm_medium=private&utm_campaign=private#private`, {
    waitUntil: "networkidle",
  });
  await expect.poll(() => names(), { timeout: 20000 }).toContain("page_view");
  assert.ok(!JSON.stringify(requests).includes("private"), "unknown UTM values never reach the real tag transport");
  console.log("PASS real Google tag omits unknown campaign values and fragments");
  await context.close();
} finally {
  await browser.close();
}
