// Channels, a screen of its own: every account with who answers it and what waits there, and each account's settings
// in a dialog of parts, saved together. Builds on the setup's Telegram and WhatsApp accounts.
import { expect, open, rpc, test, until } from "./kit.ts";

type Listed = { channels: Array<{ id: string; label: string; concurrency: string }> };

test("the Channels screen lists every account, filters by app and opens each one's chats or settings", async ({
  page,
}) => {
  await open(page);
  await page
    .locator(".sidebar__top")
    .getByRole("button", { name: /^Canales/ })
    .click();
  const screen = page.getByRole("region", { name: "Canales" });
  await expect(screen.getByRole("heading", { name: "Canales" })).toBeVisible();
  await expect(screen.getByRole("button", { name: /^Telegram/ })).toBeVisible();
  await expect(screen.getByRole("button", { name: /^WhatsApp/ })).toBeVisible();

  await screen.getByRole("radio", { name: /^WhatsApp/ }).click();
  await expect(screen.getByRole("button", { name: /^Telegram/ })).toHaveCount(0);
  await screen.getByRole("radio", { name: /^Todas/ }).click();

  // Right click: the same actions as in the sidebar.
  await screen.getByRole("button", { name: /^Telegram/ }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Contactos" })).toBeVisible();
  await page.keyboard.press("Escape");

  await screen.getByRole("button", { name: "Abrir" }).first().click();
  await expect(page.getByRole("button", { name: "Configuración del canal" })).toBeVisible();
});

test("an account's settings: parts on the left, edits wait for Save, Discard puts them back", async ({ page }) => {
  await open(page, "#view=channels");
  await page.getByRole("button", { name: "Configuración de WhatsApp" }).click();
  // Its name is the account's: it changes with a rename below.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Cuenta" })).toBeVisible();

  await dialog.getByRole("button", { name: "Comportamiento" }).click();
  const before = (await rpc<Listed>("channels.list")).channels.find((c) => c.id === "whatsapp")?.concurrency;
  await dialog.getByRole("radio", { name: before === "queue" ? "Interrumpe" : "Espera" }).click();
  await expect(dialog.getByText("Cambios sin guardar")).toBeVisible();
  // Nothing reached the core yet.
  expect((await rpc<Listed>("channels.list")).channels.find((c) => c.id === "whatsapp")?.concurrency).toBe(before);
  await dialog.getByRole("button", { name: "Descartar" }).click();
  await expect(dialog.getByText("Se guarda en APX")).toBeVisible();

  // A name typed and saved shows in the lists; the old one comes back the same way.
  await dialog.getByRole("button", { name: /^Cuenta/ }).click();
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("Personal");
  await dialog.getByRole("button", { name: /^Guardar (⌘|Ctrl)/ }).click();
  await until(async () =>
    (await rpc<Listed>("channels.list")).channels.some((c) => c.id === "whatsapp" && c.label === "Personal"),
  );
  await expect(dialog.locator(".acct__title")).toHaveText("Personal");
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("WhatsApp");
  await expect(dialog.getByText("Cambios sin guardar")).toBeVisible();
  await dialog.getByRole("button", { name: "Guardar y cerrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await until(async () =>
    (await rpc<Listed>("channels.list")).channels.some((c) => c.id === "whatsapp" && c.label === "WhatsApp"),
  );
});

test("leaving with unsaved edits asks first; contacts and what went out are listed per account", async ({ page }) => {
  await open(page, "#view=channels");
  await page.getByRole("button", { name: "Configuración de WhatsApp" }).click();
  const dialog = page.getByRole("dialog", { name: "WhatsApp" });
  await dialog.getByRole("button", { name: "Comportamiento" }).click();
  await dialog.getByRole("switch", { name: "Horario de atención" }).click();
  await page.keyboard.press("Escape");
  const ask = page.getByRole("dialog", { name: "¿Descartar los cambios?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog.getByText("Cambios sin guardar")).toBeVisible();
  await dialog.getByRole("button", { name: "Descartar" }).click();

  // Contacts: everyone on this account, with Add contact.
  await dialog.getByRole("button", { name: /^Contactos/ }).click();
  await expect(dialog.getByRole("button", { name: /Lucía/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Agregar contacto" }).click();
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("Northwind");
  await dialog.getByRole("textbox", { name: "Su dirección en WhatsApp" }).fill("+5491100000011");
  await dialog.getByRole("button", { name: "Agregar contacto" }).click();
  await expect(dialog.getByRole("button", { name: /Northwind/ })).toBeVisible();

  // Activity: what went out on this account.
  await dialog.getByRole("button", { name: "Actividad" }).click();
  await expect(dialog.getByText("Got it: Remind me to call the bank").first()).toBeVisible();
});

test("New channel lists every app; a new account's other parts wait until it is connected", async ({ page }) => {
  const ids = async () => (await rpc<Listed>("channels.list")).channels.map((c) => c.id).sort();
  const before = await ids();
  await open(page, "#view=channels");
  await page.getByRole("region", { name: "Canales" }).getByRole("button", { name: "Nuevo canal" }).click();
  const pick = page.getByRole("dialog", { name: "Nuevo canal" });
  for (const app of ["WhatsApp", "Telegram", "Discord", "Slack", "Email", "Microsoft Teams"])
    await expect(pick.getByRole("button", { name: new RegExp(`^${app}`) })).toBeVisible();
  await pick.getByRole("button", { name: /^Telegram/ }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo canal de Telegram" });
  await expect(dialog.getByText("Conectá la cuenta para continuar")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Contactos" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Conectar" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Cancel leaves no account behind.
  expect(await ids()).toEqual(before);
});
