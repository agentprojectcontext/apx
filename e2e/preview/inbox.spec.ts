import { expect, test } from "@playwright/test";

for (const width of [360, 412, 1280]) {
  for (const view of ["Tree", "Activity", "By chat"]) {
    test(`${view} groups routines and nested sessions at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const requests: string[] = [];
      page.on("request", (req) => {
        if (/\/rpc\/|\/ws(?:\?|$)/.test(req.url())) requests.push(req.url());
      });
      await page.goto("/?lang=en");
      await page.getByRole("radio", { name: view, exact: true }).click();
      const daily = page.locator('[data-routine="daily"]');
      await expect(daily).toHaveCount(1);
      await expect(page.locator(".routinebundle")).toHaveCount(3);
      await expect(daily.getByRole("button", { name: /Your morning summary/ })).toHaveCount(1);
      await expect(daily.getByRole("button", { name: /Verify the forecast/ })).toBeVisible();
      await expect(daily.getByRole("button", { name: /Previous summary 6/ })).toHaveCount(0);
      await daily.getByRole("button", { name: "Show 2 more", exact: true }).click();
      await expect(daily.getByRole("button", { name: /Previous summary 6/ })).toBeVisible();
      await daily.getByRole("button", { name: /Previous summary 6/ }).click();
      await expect(daily.locator(".is-selected")).toContainText("Previous summary 6");
      await expect(page.locator("output")).toContainText("Daily brief");
      const fold = daily.getByRole("button", { name: "Hide routine runs: Daily brief", exact: true });
      await fold.click();
      await expect(daily.locator(".tree__sessions")).toHaveCount(0);
      await daily.getByRole("button", { name: "Show routine runs: Daily brief", exact: true }).click();
      await expect(daily.getByRole("button", { name: /Previous summary 6/ })).toBeVisible();
      const consult = page.locator('.delegated[data-thread="consult"]');
      await expect(consult.getByRole("button", { name: /Check the sources/ })).toBeVisible();
      const recipient = consult.locator(".threadavatar").first();
      await expect(recipient.getByRole("img", { name: "Researcher", exact: true })).toBeVisible();
      await expect(recipient.getByRole("img", { name: "Assistant", exact: true })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      expect(requests).toEqual([]);
    });
  }
}

for (const width of [360, 1280]) {
  test(`avatars have no badge bubble and branches end in a curve at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?lang=en");
    for (const view of ["Tree", "Activity", "By chat"]) {
      await page.getByRole("radio", { name: view, exact: true }).click();
      const consult = page.locator('.delegated[data-thread="consult"]');
      const caller = consult.locator(".threadavatar__caller").first();
      await expect(caller).toBeVisible();
      await expect(caller).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(caller).toHaveCSS("box-shadow", "none");
      const branch = consult.locator(":scope > .delegated__list");
      const terminal = branch.locator(":scope > :last-child");
      await expect(terminal).toBeVisible();
      const end = await terminal.evaluate((el) => {
        const style = getComputedStyle(el, "::before");
        return {
          border: style.borderBottomWidth,
          radius: style.borderBottomLeftRadius,
          height: style.height,
          pointerEvents: style.pointerEvents,
        };
      });
      expect(end).toEqual({ border: "1px", radius: "7px", height: "15px", pointerEvents: "none" });
      const row = terminal.getByRole("button", { name: /Check the sources/ });
      await row.click();
      await expect(page.locator("output")).toContainText("Check the sources");
      await expect(row).toHaveClass(/is-selected/);
      const fold = consult.getByRole("button", { name: "Hide the chats it delegated", exact: true }).first();
      await fold.click();
      await expect(branch).toHaveCount(0);
      await consult.getByRole("button", { name: "Show the chats it delegated", exact: true }).first().click();
      await expect(terminal).toBeVisible();
    }
  });
}

test("filter and search keep routines isolated from ordinary chats", async ({ page }) => {
  await page.goto("/?lang=en");
  await page.getByRole("radio", { name: "By chat", exact: true }).click();
  await page.getByRole("searchbox").fill("Previous summary 7");
  await expect(page.locator(".routinebundle")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Previous summary 7/ })).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: "Filter chats", exact: true }).click();
  await page.getByRole("menuitem", { name: "Routine news", exact: true }).click();
  await expect(page.locator(".routinebundle")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Project planning/ })).toBeVisible();
});
