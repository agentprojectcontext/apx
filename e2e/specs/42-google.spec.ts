// Google Calendar: the owner's OAuth client typed in, "Sign in with Google" opens Google's page in a new tab, Google
// sends it back to the panel's /oauth/google page, which finishes the sign-in; the dialog closes by itself.
import { expect, open, rpc, test } from "./kit.ts";

test("Google Calendar connects by signing in with Google, shows the account, and disconnects", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Integraciones/ }).click();
  await page
    .getByRole("button", { name: /Conectar nueva|Integración/ })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Google Calendar/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("URI de redirección")).toHaveValue(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/google$/);
  await dialog.getByLabel("Client id").fill("123-abc.apps.googleusercontent.com");
  await dialog.getByLabel("Client secret").fill("fake-client-secret");

  const tab = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Iniciar sesión con Google" }).click();
  const back = await tab;
  await expect(back.getByText("Google Calendar está conectado")).toBeVisible();
  await expect(back.getByText(/owner@example\.com/)).toBeVisible();
  expect(new URL(back.url()).search, "the code leaves the address bar").toBe("");
  await back.close();

  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText(/Sesión iniciada como owner@example\.com/)).toBeVisible();
  const cal = (await rpc<{ integrations: Array<{ id: string; connected: boolean }> }>("integrations.list"))
    .integrations;
  expect(cal.find((i) => i.id === "google-calendar")?.connected).toBe(true);
  expect(JSON.stringify(cal)).not.toContain("fake-client-secret");

  await page.getByRole("button", { name: "Desconectar" }).click();
  await expect
    .poll(
      async () =>
        (await rpc<{ integrations: Array<{ id: string; connected: boolean }> }>("integrations.list")).integrations.find(
          (i) => i.id === "google-calendar",
        )?.connected,
    )
    .toBe(false);
});
