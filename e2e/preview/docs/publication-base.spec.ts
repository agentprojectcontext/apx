import { expect, test } from "@playwright/test";
import { headerLink } from "../web-nav.ts";

const base = (process.env.DOCS_BASE ?? "/").replace(/\/$/, "");
const origin = process.env.DOCS_TEST_ORIGIN ?? "http://127.0.0.1:4410";

test("published base keeps navigation, documentation redirects, search and installers inside the prefix", async ({
  page,
  request,
}, testInfo) => {
  for (const pre of ["", "/es"]) {
    await page.goto(`${origin}${base}${pre}/compare/openbot/`);
    await (await headerLink(page, ".nav__docs-link")).click();
    await expect(page).toHaveURL(`${origin}${base}${pre}/docs/start/introduction/`);
    await expect(page.locator("main h1")).toBeVisible();
    await page.goto(`${origin}${base}${pre}/start/introduction/?old=1#_top`);
    await expect(page).toHaveURL(`${origin}${base}${pre}/docs/start/introduction/?old=1#_top`);
    await page.locator("site-search button[data-open-modal]").click();
    await page.getByRole("dialog").getByRole("textbox").fill("APX");
    const result = page.locator(".pagefind-ui__result-link").first();
    await expect(result).toBeVisible();
    await expect(result).toHaveAttribute("href", new RegExp(`^${base}${pre}/docs/`));
    await result.click();
    await expect(page.locator("main h1")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(pre ? "spanish-docs.png" : "english-docs.png") });
  }
  for (const file of ["install.sh", "install.ps1"]) {
    const result = await request.get(`${origin}${base}/${file}`);
    expect(result.status()).toBe(200);
    expect((await result.body()).length).toBeGreaterThan(1000);
  }
});
