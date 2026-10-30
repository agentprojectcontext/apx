import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { headerLink, readingNav } from "../web-nav.ts";
import { expect, test } from "./site.fixture.ts";

const suffix = "?from=historical#_top";
const routes = [
  ["/docs/start/installation/", "/v1/start/installation/"],
  ["/docs/es/start/introduction/", "/v1/es/start/introduction/"],
  ["/apx/docs/start/installation/", "/v1/start/installation/"],
  ["/apx/docs/es/start/introduction/", "/v1/es/start/introduction/"],
  ["/start/introduction/", "/docs/start/introduction/"],
  ["/es/start/introduction/", "/es/docs/start/introduction/"],
  ["/v2/start/introduction/", "/docs/start/introduction/"],
  ["/v2/es/start/introduction/", "/es/docs/start/introduction/"],
  ["/apx/v2/es/start/introduction/", "/es/docs/start/introduction/"],
  ["/apx/start/introduction/", "/docs/start/introduction/"],
  ["/apx/es/start/introduction/", "/es/docs/start/introduction/"],
  ["/v1/start/introduction/", "/v1/start/introduction/"],
  ["/v1/es/start/introduction/", "/v1/es/start/introduction/"],
  ["/docs/", "/docs/start/introduction/"],
  ["/es/docs/", "/es/docs/start/introduction/"],
];

test("assembled v1 and v2 preserve historical page aliases, queries and fragments", async ({
  page,
  assembledOrigin,
  request,
}) => {
  for (const [from, target] of routes) {
    await page.goto(`${assembledOrigin}${from}${suffix}`);
    await expect(page).toHaveURL(`${assembledOrigin}${target}${suffix}`);
    await expect(page.locator("h1").first()).toBeVisible();
    expect((await request.get(`${assembledOrigin}${target}`)).status()).toBe(200);
  }
  await page.goto(`${assembledOrigin}/v2/${suffix}`);
  await expect(page).toHaveURL(`${assembledOrigin}/${suffix}`);
  for (const name of ["install.sh", "install.ps1"]) {
    const current = await request.get(`${assembledOrigin}/${name}`);
    const historical = await request.get(`${assembledOrigin}/v2/${name}`);
    expect(current.status()).toBe(200);
    expect(historical.status()).toBe(200);
    expect(await historical.body()).toEqual(await current.body());
  }
  await page.goto(`${assembledOrigin}/docs/not-a-real-page/${suffix}`);
  await expect(page).toHaveURL(`${assembledOrigin}/v1/not-a-real-page/${suffix}`);
  expect((await request.get(page.url())).status()).toBe(404);
  await expect(page.locator("h1")).toHaveText("404");
});

test("all historical pages follow the approved current-docs precedence and retain v1 content", async ({
  page,
  assembledOrigin,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const v1 = process.env.DOCS_V1_DIST;
  if (!v1) throw new Error("A real historical build is required");
  const files = (await readdir(v1, { recursive: true })).filter((file) => file.endsWith("index.html")).sort();
  expect(files).toHaveLength(80);
  const overrides = new Set([
    "",
    "concepts/agents/",
    "concepts/memory/",
    "concepts/projects/",
    "reference/troubleshooting/",
    "start/introduction/",
  ]);
  const observations = [];
  for (const file of files) {
    const relative = file
      .split(sep)
      .join("/")
      .replace(/index\.html$/, "");
    const legacy = `/docs/${relative}`;
    const historical = `/v1/${relative}`;
    const currentWins = overrides.has(relative);
    const target = relative === "" ? "/docs/start/introduction/" : currentWins ? legacy : historical;
    const archived = await request.get(`${assembledOrigin}${historical}`);
    expect(archived.status(), historical).toBe(200);
    expect(await archived.body(), historical).toEqual(await readFile(join(v1, file)));
    for (const address of [legacy, `/apx${legacy}`]) {
      await page.goto(`${assembledOrigin}${address}${suffix}`);
      await expect(page).toHaveURL(`${assembledOrigin}${target}${suffix}`);
      await expect(page.locator("h1").first()).toBeVisible();
    }
    const indexed = await request.get(`${assembledOrigin}/docs/${relative}index.html`);
    expect(indexed.status(), legacy).toBe(currentWins ? 200 : 404);
    await page.goto(`${assembledOrigin}/docs/${relative}index.html${suffix}`);
    const indexedTarget = relative === "" ? target : `${currentWins ? legacy : historical}index.html`;
    await expect(page).toHaveURL(`${assembledOrigin}${indexedTarget}${suffix}`);
    await expect(page.locator("h1").first()).toBeVisible();
    observations.push({
      legacy,
      indexedAlias: `/docs/${relative}index.html`,
      historical,
      target,
      policy:
        relative === ""
          ? "Existing current introduction alias"
          : currentWins
            ? "Current documentation takes precedence"
            : "Historical documentation preserved",
    });
  }
  expect(observations.filter((item) => item.policy === "Current documentation takes precedence")).toHaveLength(5);
  expect(observations.filter((item) => item.policy === "Historical documentation preserved")).toHaveLength(74);
  const inventory = testInfo.outputPath("historical-route-inventory.json");
  await writeFile(inventory, JSON.stringify(observations, null, 2));
  await testInfo.attach("historical-route-inventory.json", { path: inventory, contentType: "application/json" });
});

test("assembled current web navigation and comparison sources work", async ({ page, assembledOrigin }, testInfo) => {
  await page.goto(`${assembledOrigin}/es/compare/openclaw/`);
  const reading = await readingNav(page, "es");
  await reading.locator('a[href="#overview"]').click();
  await expect(reading.locator('[aria-current="location"]')).toHaveAttribute("href", "#overview");
  await expect(
    page.locator('.compare-table a[href="https://docs.openclaw.ai/concepts/multi-agent"]').first(),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("assembled-comparison.png") });
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page).toHaveURL(`${assembledOrigin}/compare/openclaw/`);
  await (await headerLink(page, ".nav__docs-link")).click();
  await expect(page).toHaveURL(`${assembledOrigin}/docs/start/introduction/`);
});

test("404 aliases never redirect outside the assembled origin", async ({ page, assembledOrigin }) => {
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== assembledOrigin) {
      if (route.request().isNavigationRequest()) externalRequests.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "text/html", body: "External destination blocked by test" });
    } else await route.continue();
  });
  for (const path of ["/apx//example.com", "/v2//example.com", "/apx/\\\\example.com", "/v2/\\\\example.com"]) {
    await page.goto(`${assembledOrigin}${path}`);
    await expect(page.locator("h1")).toHaveText("404");
    expect(new URL(page.url()).origin).toBe(assembledOrigin);
    expect(externalRequests).toEqual([]);
  }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("assembled native navigation works; script-only aliases stay 404", async ({ page, assembledOrigin }) => {
    await page.goto(`${assembledOrigin}/v2/${suffix}`);
    await expect(page).toHaveURL(`${assembledOrigin}/`);
    await expect(page.locator("h1").first()).toBeVisible();
    await page.goto(`${assembledOrigin}/start/introduction/`);
    await expect(page).toHaveURL(`${assembledOrigin}/docs/start/introduction/`);
    await page.goto(`${assembledOrigin}/v1/es/start/introduction/`);
    await expect(page.locator("h1")).toBeVisible();
    const response = await page.goto(`${assembledOrigin}/docs/start/installation/`);
    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL(`${assembledOrigin}/docs/start/installation/`);
    await page.goto(`${assembledOrigin}/compare/hermes-agent/`);
    await expect(page.locator("a[data-section][aria-current]")).toHaveCount(0);
    await (await readingNav(page)).locator('a[href="#sources"]').click();
    await expect(page.getByRole("heading", { name: "Sources and scope", exact: true })).toBeInViewport();
  });
});
