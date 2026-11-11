import { expect, type Page, test } from "@playwright/test";

// The Inbox tabs never show a total: only how many rows run now, and they shrink to icons instead of cutting a name.
const tabs = (page: Page) => page.getByRole("radiogroup", { name: "Show" });
const widthOf = async (page: Page, px: number) => {
  await page.locator(".inboxpreview__panel").evaluate((el, w) => {
    (el as HTMLElement).style.width = `${w}px`;
  }, px);
};

test("tabs show what runs, not how many there are", async ({ page }) => {
  await page.goto("/?lang=en");
  const group = tabs(page);
  await expect(group.getByRole("radio", { name: /^Chats/ })).toBeVisible();
  await expect(group.getByRole("img", { name: "2 running", exact: true })).toBeVisible();
  await expect(group.getByRole("img", { name: "1 running", exact: true })).toBeVisible();
  // Routines: nothing runs, so no number at all.
  await expect(group.getByRole("radio", { name: /^Routines/ }).locator(".inbox__tabwork")).toHaveCount(0);
});

for (const px of [420, 280, 200, 130]) {
  test(`tabs fit without cutting at ${px}px`, async ({ page }) => {
    await page.goto("/?lang=en");
    await widthOf(page, px);
    const items = tabs(page).getByRole("radio");
    await expect(items).toHaveCount(3);
    const icons = await page.locator(".inbox__tabicon").first().isVisible();
    expect(icons).toBe(px <= 300);
    for (const item of await items.all()) {
      expect(await item.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    // Names stay for screen readers when only the icons show.
    await expect(tabs(page).getByRole("radio", { name: /^Tasks/ })).toBeVisible();
  });
}
