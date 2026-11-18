// Google Calendar, from its Marketplace page: the owner's OAuth client typed in, "Sign in with Google" opens Google's
// page in a new tab, Google sends it back to the panel's /oauth/google page, which finishes the sign-in; the dialog
// closes by itself.
import { expect, open, openExtension, openExtensionSettings, rpc, test } from "./kit.ts";

test("Google Calendar connects by signing in with Google, shows the account, and disconnects", async ({ page }) => {
  await open(page);
  await openExtension(page, "Google Calendar");
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "Conectada" })).toBeDisabled();
  const settings = await openExtensionSettings(page);
  await expect(settings.getByText(/Sesión iniciada como owner@example\.com/)).toBeVisible();
  const cal = (await rpc<{ integrations: Array<{ id: string; connected: boolean }> }>("integrations.list"))
    .integrations;
  expect(cal.find((i) => i.id === "google-calendar")?.connected).toBe(true);
  expect(JSON.stringify(cal)).not.toContain("fake-client-secret");

  await settings.getByRole("button", { name: "Desconectar" }).click();
  // It asks first.
  await page
    .getByRole("dialog", { name: /¿Desconectar/ })
    .getByRole("button", { name: "Desconectar" })
    .click();
  await expect
    .poll(
      async () =>
        (await rpc<{ integrations: Array<{ id: string; connected: boolean }> }>("integrations.list")).integrations.find(
          (i) => i.id === "google-calendar",
        )?.connected,
    )
    .toBe(false);
});

test("one sign-in connects the other Google parts the owner ticks, with the same own client", async ({ page }) => {
  await open(page);
  await openExtension(page, "Gmail");
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Client id").fill("123-abc.apps.googleusercontent.com");
  await dialog.getByLabel("Client secret").fill("fake-client-secret");
  const drive = dialog.getByRole("checkbox", { name: "Google Drive" });
  await expect(drive, "nothing else joins unless the owner asks").not.toBeChecked();
  await drive.click();

  const tab = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Iniciar sesión con Google" }).click();
  const back = await tab;
  await expect(back.getByText("Gmail, Google Drive están conectados")).toBeVisible();
  await back.close();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  const list = (await rpc<{ integrations: Array<{ id: string; connected: boolean }> }>("integrations.list"))
    .integrations;
  const on = (id: string) => list.find((i) => i.id === id)?.connected;
  expect([on("gmail"), on("google-drive"), on("google-calendar")]).toEqual([true, true, false]);
  for (const id of ["gmail", "google-drive"]) await rpc("integrations.disconnect", { id });
});
