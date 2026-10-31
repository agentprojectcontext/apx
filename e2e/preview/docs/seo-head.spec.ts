import { expect, test } from "@playwright/test";

// Every landing page names its own address, both languages and a default, and shows the preview in its language.
for (const [path, image] of [
  ["/", "/og.jpg"],
  ["/es/", "/og-es.jpg"],
  ["/compare/", "/og.jpg"],
  ["/es/compare/best-ai-agent-apps/", "/og-es.jpg"],
] as const) {
  test(`${path}: canonical, languages and preview image`, async ({ page, baseURL }) => {
    await page.goto(path);
    const head = page.locator("head");
    await expect(head.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https:\/\/.+\/$/);
    for (const lang of ["en", "es", "x-default"])
      await expect(head.locator(`link[rel="alternate"][hreflang="${lang}"]`)).toHaveAttribute("href", /^https:\/\//);
    const og = await head.locator('meta[property="og:image"]').getAttribute("content");
    expect(og?.endsWith(image)).toBe(true);
    expect((await page.request.get(new URL(image, baseURL).href)).ok()).toBe(true);
    expect((await page.title()).length).toBeGreaterThanOrEqual(30);
    const description = (await head.locator('meta[name="description"]').getAttribute("content")) ?? "";
    expect(description.length).toBeGreaterThan(50);
    expect(description.length).toBeLessThanOrEqual(160);
    await expect(head.locator('meta[name="twitter:title"]')).toHaveCount(1);
    await expect(head.locator('meta[property="og:locale"]')).toHaveCount(1);
    const schema = await head.locator('script[type="application/ld+json"]').allTextContents();
    expect(schema.length).toBeGreaterThan(0);
    for (const item of schema) expect(JSON.parse(item)["@context"]).toBe("https://schema.org");
    // Every heading on the page is one a reader can see, and the title reads as words.
    const hidden = await page
      .locator("h1, h2, h3, h4, h5, h6")
      .evaluateAll((hs) => hs.filter((h) => !h.closest("[hidden]") && !h.checkVisibility()).map((h) => h.textContent));
    expect(hidden).toEqual([]);
    expect(await page.locator("h1").first().textContent()).not.toMatch(/\p{Ll}\p{Lu}|[a-z]{2}(crew|team|equipo)\./u);
  });
}

test("robots.txt points at the sitemap", async ({ request }) => {
  const body = await (await request.get("/robots.txt")).text();
  expect(body).toMatch(/^Sitemap: https:\/\/.+\/sitemap-index\.xml$/m);
});

test("llms.txt lists the guide and the comparisons with full addresses", async ({ request }) => {
  const body = await (await request.get("/llms.txt")).text();
  expect(body).toMatch(/^# APX\n\n> /);
  expect(body).toMatch(/^- \[Install\]\(https:\/\/.+\/docs\/start\/install\/\): /m);
  expect(body).toMatch(/^- \[APX vs OpenClaw\]\(https:\/\/.+\/compare\/openclaw\/\): /m);
  expect(body).not.toContain("/es/docs/");
});
