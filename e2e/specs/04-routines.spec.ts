// Routines: one that sends a Telegram message by hand, run now; the imported one came in turned off.
import { expect, open, rpc, test, until } from "./kit.ts";

test("a routine that sends a message is created and runs now", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Default", exact: true }).click();
  await page.getByRole("tab", { name: "Rutinas" }).click();
  await page.getByRole("button", { name: "Nueva rutina" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByRole("textbox", { name: "Nombre" }).fill("ping-me");
  await editor.getByRole("combobox", { name: "Acción" }).click();
  await page.getByRole("option", { name: /Telegram/ }).click();
  await editor.getByRole("textbox", { name: "Qué hacer" }).fill("Ping from the routine");
  await editor.getByRole("button", { name: "Guardar" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText("ping-me")).toBeVisible();

  await page.getByRole("button", { name: "Correr ahora" }).first().click();
  const routines = await rpc<{ routines: Array<{ id: string; name: string }> }>("routines.list", {});
  const r = routines.routines.find((x) => x.name === "ping-me");
  expect(r).toBeTruthy();
  await until(async () => {
    const runs = await rpc<{ runs: Array<{ status: string }> }>("routines.runs", { routine: r?.id });
    return runs.runs.some((x) => x.status !== "running");
  });
});
