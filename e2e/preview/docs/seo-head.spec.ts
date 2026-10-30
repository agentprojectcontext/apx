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
  });
}

test("robots.txt points at the sitemap", async ({ request }) => {
  const body = await (await request.get("/robots.txt")).text();
  expect(body).toMatch(/^Sitemap: https:\/\/.+\/sitemap-index\.xml$/m);
});
