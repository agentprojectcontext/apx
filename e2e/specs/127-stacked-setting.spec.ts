// A setting whose control needs the width (a paragraph to write) puts it right under its text, with no gap between.
import { expect, open, openSettings, rpc, test } from "./kit.ts";

test("the account's About you box sits right under its description", async ({ page }) => {
  await rpc("setup.finish");
  await open(page);
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Configuración", exact: true });
  const about = settings.getByRole("textbox", { name: "Sobre vos", exact: true });
  await expect(about).toBeVisible();
  const hint = settings.getByText("Lo que tus agentes saben de vos siempre", { exact: false });
  const top = await about.evaluate((box) => box.getBoundingClientRect().top);
  const bottom = await hint.evaluate((text) => text.getBoundingClientRect().bottom);
  expect(top - bottom).toBeLessThan(24);
});
