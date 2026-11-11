// Channels, a screen of its own: every account with who answers it and what waits there, and each account's settings
// in a dialog of parts, saved together. Builds on the setup's Telegram and WhatsApp accounts.
import { ACCOUNT_NAME, expect, open, rpc, test, until } from "./kit.ts";

type Listed = {
  channels: Array<{
    id: string;
    label: string;
    concurrency: string;
    limits?: { per_contact_hour: number; per_account_hour: number };
  }>;
};

test("the Channels screen lists every account, filters by app and opens each one's chats or settings", async ({
  page,
}) => {
  await open(page);
  // The sidebar's Channels section leads there too, narrow sidebar included.
  await expect(page.locator(".sidebar").getByRole("button", { name: "Administrar canales" })).toBeVisible();
  // From an account's Inbox, the account switcher leads to the screen with every account.
  await page.getByRole("button", { name: ACCOUNT_NAME.whatsapp, exact: true }).click();
  await page.locator(".inbox__accountbtn").click();
  await page.getByRole("dialog", { name: "Cuentas" }).getByRole("button", { name: "Administrar canales" }).click();
  const screen = page.getByRole("region", { name: "Canales" });
  await expect(screen.getByRole("heading", { name: "Canales" })).toBeVisible();
  await expect(screen.locator(".chs__main", { hasText: ACCOUNT_NAME.telegram })).toBeVisible();
  await expect(screen.locator(".chs__main", { hasText: ACCOUNT_NAME.whatsapp })).toBeVisible();

  const filter = screen.getByRole("group", { name: "Canales" });
  await filter.getByRole("button", { name: /^WhatsApp/ }).click();
  await expect(screen.locator(".chs__main", { hasText: ACCOUNT_NAME.telegram })).toHaveCount(0);
  await filter.getByRole("button", { name: /^Todas/ }).click();

  // Right click: the same actions as in the sidebar.
  await screen.locator(".chs__main", { hasText: ACCOUNT_NAME.telegram }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Contactos" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Each row says what the account does for everyone on it, and what it does not (dimmed); its tools are icons.
  const row = screen.locator(".chs__row", { hasText: ACCOUNT_NAME.telegram });
  await expect(row.getByRole("img", { name: "No anota citas" })).toBeVisible();
  await expect(row.getByRole("button", { name: `Contactos de ${ACCOUNT_NAME.telegram}` })).toBeVisible();
  await expect(row.getByRole("button", { name: "Abrir" })).toHaveCount(0);
  await screen.locator(".chs__main", { hasText: ACCOUNT_NAME.telegram }).click();
  await expect(page.getByRole("button", { name: "Configuración del canal" })).toBeVisible();
});

test("an account's settings: parts on the left, edits wait for Save, Discard puts them back", async ({ page }) => {
  await open(page, "#view=channels");
  await page.getByRole("button", { name: `Configuración de ${ACCOUNT_NAME.whatsapp}` }).click();
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
  await expect(dialog.getByText("Guardado en APX")).toBeVisible();

  // Its limits on answers to contacts: typed, kept on Save.
  const perContact = dialog.getByRole("spinbutton", { name: "Respuestas por hora a un contacto" });
  await expect(perContact).toHaveValue("20");
  await perContact.fill("12");
  await perContact.blur();
  await dialog.getByRole("button", { name: /^Guardar (⌘|Ctrl)/ }).click();
  await until(async () =>
    (await rpc<Listed>("channels.list")).channels.some(
      (c) => c.id === "whatsapp" && c.limits?.per_contact_hour === 12 && c.limits.per_account_hour === 0,
    ),
  );

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
  await page.getByRole("button", { name: `Configuración de ${ACCOUNT_NAME.whatsapp}` }).click();
  const dialog = page.getByRole("dialog", { name: "WhatsApp" });
  await dialog.getByRole("button", { name: "Comportamiento" }).click();
  await dialog.getByRole("switch", { name: "Horario de atención" }).click();
  await page.keyboard.press("Escape");
  const ask = page.getByRole("dialog", { name: "¿Descartar los cambios?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog.getByText("Cambios sin guardar")).toBeVisible();
  await dialog.getByRole("button", { name: "Descartar" }).click();

  // Contacts: what every contact of the account may do unless set on their card, everyone on it, and Add contact.
  await dialog.getByRole("button", { name: /^Contactos/ }).click();
  await dialog.getByRole("switch", { name: "Tomar pedidos", exact: true }).click();
  await dialog.getByRole("button", { name: /^Guardar (⌘|Ctrl)/ }).click();
  await until(async () =>
    (await rpc<{ channels: Array<{ id: string; contacts?: { requests?: boolean } }> }>("channels.list")).channels.some(
      (c) => c.id === "whatsapp" && c.contacts?.requests === true,
    ),
  );
  await dialog.getByRole("switch", { name: "Tomar pedidos", exact: true }).click();
  await dialog.getByRole("button", { name: /^Guardar (⌘|Ctrl)/ }).click();
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

test("in the folded, compact sidebar the channels list names Manage channels in words", async ({ page }) => {
  // Narrow enough for the rail, short enough for every section to be one row that opens beside it.
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page);
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toHaveClass(/is-rail/);
  await sidebar
    .getByRole("button", { name: /^Canales/ })
    .first()
    .click();
  const manage = page.getByRole("button", { name: "Administrar canales" });
  await expect(manage.locator(".apx-nav__label")).toHaveText("Administrar canales");
});

test("an account picked under Channels lights Channels, and Inbox leads back to every chat", async ({ page }) => {
  await open(page);
  const sidebar = page.locator(".sidebar");
  await sidebar.getByRole("button", { name: ACCOUNT_NAME.whatsapp, exact: true }).first().click();
  // The Inbox narrowed to that account: its header, and Channels is where the owner is.
  await expect(page.locator(".inbox__accountbtn")).toBeVisible();
  const inbox = sidebar.getByRole("button", { name: /^Inbox/ }).first();
  await expect(inbox).not.toHaveClass(/is-active/);
  await inbox.click();
  await expect(page.locator(".inbox__accountbtn")).toHaveCount(0);
  await expect(page.locator(".inbox__title")).toHaveText("Inbox");
  await expect(inbox).toHaveClass(/is-active/);
});

test("an account picked under Channels opens its newest chat, not the one that was open", async ({ page }) => {
  const { threads } = await rpc<{
    threads: Array<{ id: string; updated_at: string; archived?: boolean; channel?: { id: string } }>;
  }>("threads.list");
  const newest = threads
    .filter((t) => t.channel?.id === "whatsapp" && !t.archived)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  expect(newest).toBeTruthy();
  await open(page, "#thread=home");
  await page.locator(".sidebar").getByRole("button", { name: ACCOUNT_NAME.whatsapp, exact: true }).first().click();
  await expect(page.locator(".inbox__accountbtn")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`thread=${newest?.id}`));
});
