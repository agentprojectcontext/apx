import { expect, open, test } from "./kit.ts";

for (const language of ["en", "es"] as const) {
  for (const width of [1280, 390]) {
    test(`phone privacy has no invented connection or unknown switch state: ${language} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((language) => localStorage.setItem("apx.prefs", JSON.stringify({ language })), language);
      await page.route("**/rpc/car.settings", (route) =>
        route.fulfill({
          json: {
            ok: true,
            result: {
              settings: {
                enabled: true,
                reach: "normal",
                source: "osm",
                tell_in_chat: false,
                voice_while_driving: true,
              },
              google_key: false,
              phone: true,
            },
          },
        }),
      );
      let unavailable = true;
      await page.route("**/rpc/phone.privacy", (route) =>
        route.fulfill({
          json: unavailable
            ? { ok: false, error: { code: "unavailable", message: "Offline" } }
            : { ok: true, result: { location: true, trips: false, revision: "current", trip_revision: "current" } },
        }),
      );
      await open(page);
      await page.keyboard.press("ControlOrMeta+,");
      const dialog = page.getByRole("dialog", { name: language === "en" ? "Settings" : "Configuración", exact: true });
      await dialog.getByRole("button", { name: language === "en" ? "In the car" : "En el auto", exact: true }).click();
      const global = dialog.getByRole("switch", {
        name: language === "en" ? "Errands on all phones" : "Recados en todos los teléfonos",
      });
      await expect(global).toBeChecked();
      await expect(global).toHaveAccessibleDescription(
        language === "en"
          ? "Turns errands on the way on or off for every phone at once."
          : "Enciende o apaga los recados en el camino en todos los teléfonos a la vez.",
      );
      await expect(dialog.getByText(language === "en" ? "Connected" : "Conectado", { exact: true })).toHaveCount(0);
      await dialog
        .getByRole("button", { name: language === "en" ? "Manage trip location" : "Configurar ubicación de viajes" })
        .click();
      const region = dialog.getByRole("region", {
        name: language === "en" ? "Phone location" : "Ubicación del teléfono",
      });
      await expect(region).toBeInViewport();
      await expect(region.getByRole("alert")).toContainText(
        language === "en" ? "Couldn’t check the current setting" : "No se pudo consultar el estado",
      );
      await expect(region.getByRole("switch")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("privacy-unknown.png") });
      unavailable = false;
      await region.getByRole("button", { name: language === "en" ? "Try again" : "Probar de nuevo" }).click();
      const location = region.getByRole("switch", {
        name: language === "en" ? "Location on request" : "Ubicación a pedido",
      });
      await expect(location).toBeChecked();
      await expect(location).toHaveAccessibleDescription(/phones|teléfonos/);
      await expect(
        region.getByRole("switch", { name: language === "en" ? "Location during trips" : "Ubicación durante viajes" }),
      ).not.toBeChecked();
      await page.screenshot({ path: info.outputPath("privacy-confirmed.png") });
    });
  }
}
