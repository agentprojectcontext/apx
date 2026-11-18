// Settings › Account: one card for who you are. Signed out it is you with "Sign in with Google" beside you; signed in
// (a stand-in for the account, so no Google account is touched), the same card shows the account's ID with "Sign out",
// and a name typed here is replaced by the account's only if the owner says so, after seeing both.
import type { Page } from "@playwright/test";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

const accountOf = (profile: object | null) => ({
  json: { ok: true, result: { available: true, profile, pending: false } },
});

async function openAccount(page: Page) {
  await openSettings(page);
  // Settings opens on Account.
  return page.getByRole("dialog", { name: "Configuración", exact: true });
}

test("signed out, the account card is you with the sign-in beside you, and nothing about the browser", async ({
  page,
}) => {
  await rpc("setup.finish");
  await page.route("**/rpc/account.get", (route) => route.fulfill(accountOf(null)));
  await open(page);
  const settings = await openAccount(page);
  const card = settings.getByRole("region", { name: "Cuenta" });
  await expect(card.getByText("Dueño de esta instalación")).toBeVisible();
  await expect(card.getByRole("button", { name: "Iniciar sesión con Google" })).toBeVisible();
  await expect(settings.getByText("Cuenta en la nube")).toHaveCount(0);
  await expect(settings.getByText(/navegador en la computadora/)).toHaveCount(0);
  await expect(settings.getByText("Nombre de usuario")).toHaveCount(0);
});

test("signed in with another name: the owner sees both and keeps or takes the account's", async ({ page }, info) => {
  await rpc("setup.finish");
  await rpc("owner.set", { name: "Ani" });
  await page.route("**/rpc/account.get", (route) =>
    route.fulfill(accountOf({ id: "9bspfhsq", name: "Ana Acme", photo: "", handle: "" })),
  );
  await open(page);
  const settings = await openAccount(page);

  const choice = page.getByRole("dialog", { name: "¿Usar el nombre de tu cuenta de Google?" });
  await expect(choice.getByText("Ani", { exact: true })).toBeVisible();
  await expect(choice.getByText("Ana Acme", { exact: true })).toBeVisible();
  await expect(choice.getByText(/se reemplaza “Ani”/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("account-name-choice.png") });
  await choice.getByRole("button", { name: "Usar Ana Acme" }).click();
  await expect(choice).toBeHidden();
  await expect.poll(async () => (await rpc<{ name: string }>("owner.get")).name).toBe("Ana Acme");

  const card = settings.getByRole("region", { name: "Cuenta" });
  await expect(card.getByText("Ana Acme", { exact: true })).toBeVisible();
  await expect(card.getByText(/Tu ID de APX: 9bspfhsq/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  await expect(settings.getByRole("textbox", { name: "Nombre de usuario" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("account-signed-in.png") });

  // Asked once for that account: reopening the screen does not ask again.
  await page.reload();
  await openAccount(page);
  await expect(page.getByText("¿Usar el nombre de tu cuenta de Google?")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("account-signed-in-phone.png") });
});

test("keeping the typed name leaves it as it was", async ({ page }) => {
  await rpc("setup.finish");
  await rpc("owner.set", { name: "Ani" });
  await page.route("**/rpc/account.get", (route) =>
    route.fulfill(accountOf({ id: "k7q9mx2a", name: "Ana Acme", photo: "", handle: "" })),
  );
  await open(page);
  await openAccount(page);
  const choice = page.getByRole("dialog", { name: "¿Usar el nombre de tu cuenta de Google?" });
  await choice.getByRole("button", { name: "Dejar Ani" }).click();
  await expect(choice).toBeHidden();
  expect((await rpc<{ name: string }>("owner.get")).name).toBe("Ani");
});
