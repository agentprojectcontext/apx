// The welcome to v2 as the release: said once per device, with the launch film from the docs site; where it cannot load,
// YouTube's player plays it in the same place. Outside hosts are stood in for: the sandbox never reaches them.
import { expect, open, test } from "./kit.ts";

test.use({ welcome: true });

test("the welcome shows once with the film, and closed it does not come back", async ({ page }) => {
  await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
  await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ body: "<html></html>" }));
  await open(page);
  const dialog = page.getByRole("dialog", { name: "APX v2 ya es la versión oficial" });
  await expect(dialog).toBeVisible();
  // The docs copy could not load: YouTube's player takes its place, in the dialog.
  await expect(dialog.locator('iframe[title="APX v2: el superagente y su equipo trabajando"]')).toBeVisible();

  await dialog.getByRole("button", { name: "Vamos" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(dialog).toBeHidden();
});
