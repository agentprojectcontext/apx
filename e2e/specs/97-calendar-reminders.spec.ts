import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("Google Calendar's settings turn event reminders on and choose how long before", async ({ page }) => {
  await rpc("setup.finish");
  const catalog = await rpc<Result<"integrations.list">>("integrations.list");
  await page.route("**/rpc/integrations.list", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        result: {
          integrations: catalog.integrations.map((i) =>
            i.id === "google-calendar" || i.id === "github"
              ? { ...i, connected: true, oauth: i.oauth && { ...i.oauth, account: "user@example.com" } }
              : { ...i, connected: false },
          ),
        },
      },
    });
  });
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Integraciones/ }).click();
  await page.getByRole("button", { name: /^GitHub/ }).click();
  await expect(page.getByRole("radiogroup", { name: "Dónde se usa" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Configurar integración", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /^Google Calendar/ }).click();
  await expect(page.getByRole("radiogroup", { name: "Dónde se usa" })).toBeVisible();
  await page.getByRole("button", { name: "Configurar integración", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Configurar integración", exact: true });
  await expect(settings.getByText("Dónde se usa")).toHaveCount(0);
  const lead = settings.getByRole("spinbutton", { name: "Con cuánta anticipación" });
  await expect(lead).toHaveValue("30");
  await expect(lead).toBeDisabled();
  await settings.getByRole("switch", { name: "Avisarme de mis eventos" }).click();
  await expect(lead).toBeEnabled();
  await lead.fill("2");
  await settings.getByRole("combobox", { name: "Unidad" }).click();
  await page.getByRole("option", { name: "Horas" }).click();
  await expect
    .poll(
      async () =>
        (await rpc<Result<"integrations.settings">>("integrations.settings", { id: "google-calendar" })).reminders,
    )
    .toEqual({ enabled: true, lead_min: 120 });
  await expect(settings.getByRole("spinbutton", { name: "Con cuánta anticipación" })).toHaveValue("2");
});
