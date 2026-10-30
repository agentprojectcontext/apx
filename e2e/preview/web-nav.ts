import type { Locator, Page } from "@playwright/test";

/** A header link; on narrow screens the links live behind the menu button, which is opened first. */
export async function headerLink(page: Page, selector: string): Promise<Locator> {
  const toggle = page.locator(".web-header .nav__toggle");
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return page.locator(`.web-header ${selector}`);
}

/**
 * A comparison's "On this page" navigation, ready to use: the rail on wide screens (it shows once the short answer
 * is on screen), the chip under the header on narrower ones (opened).
 */
export async function readingNav(page: Page, lang: "en" | "es" = "en"): Promise<Locator> {
  await page.locator("#answer").evaluate((section) => section.scrollIntoView({ block: "start", behavior: "instant" }));
  const nav = page.getByRole("navigation", { name: lang === "es" ? "En esta página" : "On this page", exact: true });
  const summary = nav.locator("summary");
  if ((await summary.count()) && (await summary.isVisible())) {
    const open = await nav.locator("details").evaluate((details) => (details as HTMLDetailsElement).open);
    if (!open) await summary.click();
  }
  return nav;
}
