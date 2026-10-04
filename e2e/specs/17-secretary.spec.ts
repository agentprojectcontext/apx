// The secretary profile: turned on in Config, it seeds the day's open and close (always arrive) and the watch on the
// super-agent; the time of the open is changed there and its routine follows.
import { expect, open, rpc, test } from "./kit.ts";

type Routine = { name: string; origin?: string; enabled: boolean; anchor: boolean; schedule: { cron?: string } };

test("turning the secretary on seeds its routines; a new time moves the morning brief", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("secretaria");
  await page.getByRole("option", { name: /Secretaria/ }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await expect(dialog.getByText("Activala para crearlas.")).toBeVisible();
  await dialog.getByRole("switch", { name: "Secretaria activa" }).click();
  for (const name of ["Abrir el día", "Cerrar el día", "Watch"])
    await expect(dialog.getByText(name, { exact: true })).toBeVisible();

  await dialog.getByLabel("Abre el día", { exact: true }).fill("07:15");
  await expect
    .poll(async () => {
      const { routines } = await rpc<{ routines: Routine[] }>("secretary.get");
      return routines.find((r) => r.origin === "secretary:day-open")?.schedule.cron;
    })
    .toBe("15 7 * * 1-5");
  const { routines } = await rpc<{ routines: Routine[] }>("secretary.get");
  expect(routines.find((r) => r.origin === "secretary:day-close")?.anchor).toBe(true);

  // Off again for the specs after this one: its routines stay, turned off.
  await dialog.getByRole("switch", { name: "Secretaria activa" }).click();
  await expect
    .poll(async () => (await rpc<{ routines: Routine[] }>("secretary.get")).routines.every((r) => !r.enabled))
    .toBe(true);
});
