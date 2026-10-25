// The welcome to v2 as the release: said once per device, with the launch film from the docs site; where it cannot load,
// its still opens it on YouTube. The docs host is stood in for: the sandbox never reaches it.
import { expect, open, test } from "./kit.ts";

test.use({ welcome: true });

test("the welcome shows once with the film, and closed it does not come back", async ({ page }) => {
  await page.route("https://agentprojectcontext.github.io/**", (route) => route.abort("aborted"));
  await open(page);
  const dialog = page.getByRole("dialog", { name: "APX v2 ya es la versión oficial" });
  await expect(dialog).toBeVisible();
  // The docs copy could not load: its still stands in, and opens the film on YouTube.
  const popup = page.waitForEvent("popup");
  await page.context().route("https://youtu.be/**", (route) => route.fulfill({ body: "ok" }));
  await dialog.locator(".welcome__still").click();
  expect((await popup).url()).toContain("youtu.be/biFjPPuvg9o");

  await dialog.getByRole("button", { name: "Vamos" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(dialog).toBeHidden();
});
