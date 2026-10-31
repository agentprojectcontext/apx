import { expect, type Page } from "@playwright/test";

export async function checkConsent(page: Page, origin: string, pre: string, path: string) {
  const requests: string[] = [];
  await page.context().route(/https:\/\/[^/]*(google-analytics\.com|googletagmanager\.com)\//, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ contentType: "text/javascript", body: "" });
  });
  await page.goto(`${origin}${pre}${path}?email=private%40example.com#private`);
  const consent = page.locator("[data-analytics-consent]");
  const panel = consent.locator("[data-cookie-panel]");
  await expect(consent).toHaveCount(1);
  await expect(panel).toBeVisible();
  expect(requests).toHaveLength(0);
  const privacy = `${pre}/docs/reference/website-privacy/`;
  await expect(panel.getByRole("link")).toHaveAttribute("href", privacy);
  const response = await page.request.get(`${origin}${privacy}`);
  expect(response.status()).toBe(200);
  await expect(page.locator("[data-cookie-accept]")).toHaveText(pre ? "Aceptar" : "Accept");
  await page.locator("[data-cookie-reject]").click();
  await expect(panel).toBeHidden();
  await page.reload();
  await expect(panel).toBeHidden();
  expect(requests).toHaveLength(0);
  await page.locator("[data-cookie-settings]").click();
  await expect(page.locator("[data-cookie-reject]")).toBeFocused();
  await page.locator("[data-cookie-accept]").click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toContain("G-BZT6ME07J4");
  const event = await page.evaluate(() => {
    const win = window as Window & { dataLayer?: ArrayLike<unknown>[] };
    return win.dataLayer?.map((entry) => Array.from(entry)).find((entry) => entry[0] === "event");
  });
  expect(event?.[2]).toEqual({ page_location: `${origin}${pre}${path}`, page_referrer: "", page_title: "APX website" });
  await page.goto(`${origin}${privacy}`);
  await expect(panel).toBeHidden();
  await page.locator("[data-cookie-settings]").click();
  await page.locator("[data-cookie-reject]").click();
  await expect(panel).toBeHidden();
  const afterDecline = requests.length;
  await page.goto(`${origin}${pre}/compare/openbot/`);
  await expect(panel).toBeHidden();
  await expect(page.locator("[data-cookie-settings]")).toBeVisible();
  expect(requests).toHaveLength(afterDecline);
}
