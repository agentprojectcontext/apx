import { expect, test } from "@playwright/test";

// Download links are resolved when the site is built, so they hold even when the reader's browser cannot reach
// GitHub's API (its anonymous limit is 60 calls an hour per address).
for (const path of ["/", "/es/", "/docs/start/introduction/", "/es/docs/start/introduction/"]) {
  test(`${path}: every download link points straight at a v2 release file`, async ({ page }) => {
    const api: string[] = [];
    await page.route("https://api.github.com/**", (route) => {
      api.push(route.request().url());
      return route.abort();
    });
    await page.goto(path);
    const links = page.locator("a[data-file]");
    expect(await links.count()).toBeGreaterThanOrEqual(path.includes("docs") ? 6 : 12);
    for (const link of await links.all()) {
      const file = (await link.getAttribute("data-file")) ?? "";
      const href = (await link.getAttribute("href")) ?? "";
      expect(href, file).toMatch(
        /^https:\/\/github\.com\/agentprojectcontext\/apx\/releases\/download\/v2\.\d+\.\d+\//,
      );
      expect(href.endsWith(file), `${href} ends with ${file}`).toBe(true);
      await expect(link).toHaveAttribute("data-release", /^v2\.\d+\.\d+$/);
    }
    // The main button follows the reader's system and keeps a direct link too.
    const main = page.locator(".getapx__main").first();
    await expect(main).toHaveAttribute("href", /\/releases\/download\/v2\.\d+\.\d+\/|#download$/);
    expect(api.length).toBeLessThanOrEqual(1);
  });
}
