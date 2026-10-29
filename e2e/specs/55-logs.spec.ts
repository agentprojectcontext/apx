// Logs: the owner finds the core's log in Settings › Logs — the file it lives in, its newest lines, narrowed by level
// and by text — and the view is still there after moving to another section and back.
import { expect, open, rpc, test } from "./kit.ts";

test("the owner reads the core's log in settings, narrows it and finds the file", async ({ page }) => {
  await rpc("setup.finish", {});
  const log = await rpc<{ path: string; exists: boolean }>("system.logs", { limit: 5 });
  expect(log.exists).toBe(true);

  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("registros");
  await page.getByRole("option", { name: /Registros/ }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await expect(dialog.getByRole("heading", { name: "Registros" })).toBeVisible();
  await expect(dialog.getByText(log.path)).toBeVisible();

  // The core's start can be far back on a core other specs have used a while: it is found by text.
  const lines = dialog.getByRole("list", { name: "Registros" });
  await expect(lines.getByRole("listitem").first()).toBeVisible();
  const search = dialog.getByRole("searchbox", { name: "Buscar en el registro" });
  await search.fill("core listening");
  await expect(lines.getByText("apx core listening").first()).toBeVisible();

  // Only errors: the core's start is not one.
  await dialog.getByRole("radio", { name: "Error" }).click();
  await expect(lines.getByText("apx core listening")).toHaveCount(0);

  // All levels again, then a text nothing logs.
  await dialog.getByRole("radio", { name: "Todos" }).click();
  await expect(lines.getByText("apx core listening").first()).toBeVisible();
  await search.fill("nothing-logs-this-e2e-text");
  await expect(dialog.getByText("Ninguna línea coincide")).toBeVisible();

  // Another section and back: the view opens again with the log.
  await dialog.getByRole("button", { name: "Avanzado" }).click();
  await expect(dialog.getByRole("heading", { name: "Avanzado" })).toBeVisible();
  await dialog.getByRole("button", { name: "Registros" }).click();
  await expect(dialog.getByText(log.path)).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Registros" }).getByRole("listitem").first()).toBeVisible();
});
