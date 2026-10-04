// Profiles: picked in Config › Perfil, the secretary seeds the day's open and close (always arrive) and the watch on
// the super-agent; the time of the open is changed there and its routine follows. Another profile takes over.
import { expect, open, rpc, test } from "./kit.ts";

type Routine = { name: string; origin?: string; enabled: boolean; anchor: boolean; schedule: { cron?: string } };
type Listed = { active: { id: string | null }; routines: Routine[] };

test("picking the secretary seeds its routines; a new time moves the morning brief; another profile takes over", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("perfil");
  await page.getByRole("option", { name: /Perfil/ }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await expect(dialog.getByRole("radio", { name: /Ninguno/ })).toBeChecked();
  await dialog.getByRole("radio", { name: /Secretaria/ }).click();
  for (const name of ["Abrir el día", "Cerrar el día", "Vigilar"])
    await expect(dialog.getByText(name, { exact: true }).last()).toBeVisible();

  await dialog.getByLabel("Abrir el día", { exact: true }).fill("07:15");
  await expect
    .poll(async () => {
      const { routines } = await rpc<Listed>("profiles.list");
      return routines.find((r) => r.origin === "secretary:day-open")?.schedule.cron;
    })
    .toBe("15 7 * * 1-5");
  const { routines } = await rpc<Listed>("profiles.list");
  expect(routines.find((r) => r.origin === "secretary:day-close")?.anchor).toBe(true);

  await dialog.getByRole("radio", { name: /Coach de foco/ }).click();
  await expect(dialog.getByText("Una cosa para hoy", { exact: true }).last()).toBeVisible();
  await expect.poll(async () => (await rpc<Listed>("profiles.list")).active.id).toBe("focus");

  // None again for the specs after this one: the routines stay, turned off.
  await dialog.getByRole("radio", { name: /Ninguno/ }).click();
  await expect.poll(async () => (await rpc<Listed>("profiles.list")).active.id).toBe(null);
  const all = (await rpc<{ routines: Routine[] }>("routines.list")).routines;
  expect(all.filter((r) => r.origin).every((r) => !r.enabled)).toBe(true);
});
