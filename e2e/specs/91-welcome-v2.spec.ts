// The welcome film: said once per device and film, played from the docs site; where it cannot load, its poster stays
// in its place. Outside hosts are stood in for: the sandbox never reaches them.
import { expect, open, test } from "./kit.ts";

test.use({ welcome: true });

test("the what's-new film shows once, and closed it does not come back", async ({ page }) => {
  await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Lo nuevo de APX" });
  await expect(dialog).toBeVisible();
  // The docs copy could not load: the poster takes its place.
  await expect(dialog.getByRole("img", { name: "Lo nuevo de APX" })).toBeVisible();

  await dialog.getByRole("button", { name: "Vamos" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("someone who closed the v2 welcome still sees the new film once", async ({ page }) => {
  await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
  // What a device that closed the v2 welcome kept.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("apx.corner", JSON.stringify({ discord: true, star: true, welcome: true }));
    } catch {}
  });
  await open(page);
  await expect(page.getByRole("dialog", { name: "Lo nuevo de APX" })).toBeVisible();
});
