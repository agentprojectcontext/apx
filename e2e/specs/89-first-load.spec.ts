// What the inbox downloads when the panel opens, the late parts it fetches on its own included: never zod (the
// protocol's schemas, for the screens that validate) and never a screen the owner has not opened.
import { expect, open, test } from "./kit.ts";

test("opening the panel downloads no schema library and no screen that is not on it", async ({ page }) => {
  const scripts = new Map<string, Promise<string>>();
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (url.pathname.startsWith("/assets/") && url.pathname.endsWith(".js")) scripts.set(url.pathname, res.text());
  });
  await open(page);
  await page.waitForLoadState("networkidle");
  const names = [...scripts.keys()];
  expect(names.length).toBeGreaterThan(0);
  for (const screen of ["ProjectScreen", "ConfigModal", "ChannelScreen", "ProjectSettings", "WidgetChat"])
    expect(names.filter((n) => n.startsWith(`/assets/${screen}-`))).toEqual([]);
  // zod keeps its class names as strings in a minified build.
  const withZod = [];
  for (const [name, text] of scripts) if ((await text).includes("$ZodType")) withZod.push(name);
  expect(withZod).toEqual([]);
});
