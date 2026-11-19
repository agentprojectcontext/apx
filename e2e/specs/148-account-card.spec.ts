// Settings › Account: one card for who you are. Signed out it is you with "Sign in with Google" beside you; signed in
// (a stand-in for the account, so no Google account is touched), the same card shows the account's ID with "Sign out",
// and a name typed here is replaced by the account's only if the owner says so, after seeing both.
import type { Page } from "@playwright/test";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

/** A 1×1 picture standing in for the Google photo. */
const PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const accountOf = (profile: object | null) => ({
  json: { ok: true, result: { available: true, profile, pending: false, unreadable: false } },
});

test.beforeEach(async ({ page }) => {
  await page.route("**/rpc/surfaces.public_list", (route) =>
    route.fulfill({ json: { ok: true, result: { items: [], count: 0, bytes: 0 } } }),
  );
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
    route.fulfill(accountOf({ id: "9bspfhsq", name: "Ana Acme", photo: PHOTO, handle: "" })),
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
  // The sidebar's account row shows the same photo.
  await expect(page.locator(".account__avatar img")).toHaveAttribute("src", PHOTO);
  await expect(settings.getByRole("textbox", { name: "Nombre de usuario" })).toBeVisible();

  // How to be called is apart from the name: the agents and the panel use it, the card keeps the name.
  const callMe = settings.getByRole("textbox", { name: "Cómo querés que te llamen" });
  await callMe.fill("Ani");
  await callMe.press("Enter");
  await expect.poll(async () => (await rpc<{ call_me: string }>("owner.get")).call_me).toBe("Ani");
  await expect(card.getByText("Ana Acme", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("account-call-me.png") });
  await page.screenshot({ path: info.outputPath("account-signed-in.png") });

  // Asked once for that account: reopening the screen does not ask again. The sidebar calls you as you asked.
  await page.reload();
  await expect(page.getByRole("button", { name: "Cuenta: Ani" })).toBeVisible();
  await openAccount(page);
  await expect(page.getByText("¿Usar el nombre de tu cuenta de Google?")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("account-signed-in-phone.png") });

  // Signing out asks first, as everything that takes something away does.
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  const leaving = page.getByRole("dialog", { name: "¿Cerrar sesión de tu cuenta APX en esta compu?" });
  await expect(leaving.getByText(/Tu ID de APX, tu nombre de usuario y tu trabajo acá se quedan/)).toBeVisible();
  await leaving.getByRole("button", { name: "Cancelar" }).click();
  await expect(leaving).toBeHidden();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
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
