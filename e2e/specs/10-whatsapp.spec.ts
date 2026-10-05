// WhatsApp, emulated: a line of its own linked with the QR, the owner's phone linked by writing to it, strangers asked
// about on the owner's phone, and the line turned into the owner's own phone ("Message yourself").
import { expect, open, rpc, test, until, world } from "./kit.ts";

const LINE = "5491100000001@s.whatsapp.net";
const ME = { phone: "5491100000007@s.whatsapp.net", name: "Mi teléfono" };
const FRIEND = { phone: "5491100000009@s.whatsapp.net", name: "Lucía" };
/** The owner's Telegram chat, linked by 06-telegram. */
const TELEGRAM_OWNER = 4242;

test("the owner links a line with the QR, then their own phone by writing to it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Agregar canal" }).click();
  await page.getByRole("menuitem", { name: /WhatsApp/ }).click();
  await expect(page.getByRole("switch", { name: "Esta línea es mi propio teléfono" })).not.toBeChecked();
  await page.getByRole("button", { name: "Vincular" }).click();
  await expect(page.getByRole("img", { name: "Escaneá este código con tu teléfono" })).toBeVisible();

  await world.whatsapp.scan();
  await expect(page.getByText("+5491100000001").first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Escaneá este código con tu teléfono" })).toBeHidden();
  await expect(page.getByText("Todavía no está vinculado", { exact: false })).toBeVisible();
  await expect(page.getByText("El agente que contesta en WhatsApp.")).toBeVisible();

  // "Message yourself" on a line of its own is nobody.
  const calls = await world.llmCalls();
  await world.whatsapp.fromOwner("hello from the line");
  await new Promise((r) => setTimeout(r, 300));
  expect(await world.llmCalls()).toBe(calls);

  await world.whatsapp.message(ME, "soy yo");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await expect(page.getByText("Vinculá tu teléfono")).toBeVisible();
  await expect(page.getByText("+5491100000007")).toBeVisible();
  await page.getByRole("button", { name: "Es mi número" }).click();
  await expect(page.getByRole("button", { name: /^Vos Tu teléfono/ })).toBeVisible();
  await expect(page.getByText("Vinculá tu teléfono")).toBeHidden();

  // The owner's chat on the channel opens a side panel like any chat.
  await page.getByRole("button", { name: /^Vos Tu teléfono/ }).click();
  await page.getByRole("button", { name: /Abrir panel lateral|Panel:/ }).click();
  await page.getByRole("menuitem", { name: "Widget" }).click();
  await expect(page.getByRole("complementary", { name: "Panel lateral" })).toBeVisible();

  await world.whatsapp.message(ME, "Remind me to call the bank");
  await until(async () =>
    (await world.whatsapp.sentTo(ME.phone)).some((t) => t.includes("Got it: Remind me to call the bank")),
  );
});

test("strangers 'ask me': the owner hears where their notices go who wrote and what; once let in, that message is answered", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await page.getByRole("button", { name: "Configuración del canal" }).click();
  await page.getByRole("radio", { name: "Avisarme" }).click();
  await expect(page.getByText(/Te llega un aviso con quién escribió/)).toBeVisible();
  // A setting changes in place: the line stays connected and every section stays on screen.
  await expect(page.getByText("Conectando con WhatsApp…")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Se suma" })).toBeVisible();
  await until(async () =>
    (await rpc<{ channels: Array<{ id: string; strangers: string }> }>("channels.list")).channels.some(
      (c) => c.id === "whatsapp" && c.strangers === "ask",
    ),
  );

  await world.whatsapp.message(FRIEND, "hola, ¿vamos el sábado?");
  // The owner linked Telegram earlier in this sandbox: their notices go there, with the buttons to decide.
  const notice = await until(async () =>
    (await world.sentTo(TELEGRAM_OWNER)).find((m) => m.text?.includes("+5491100000009")),
  );
  expect(notice.text).toContain("Lucía");
  expect(notice.text).toContain("¿vamos el sábado?");
  expect(await world.whatsapp.sentTo(FRIEND.phone)).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(page.getByText("“hola, ¿vamos el sábado?”")).toBeVisible();
  await page.getByRole("button", { name: "Aceptar como contacto" }).click();
  await until(async () => (await world.whatsapp.sentTo(FRIEND.phone)).some((t) => t.startsWith("Got it:")));
});

test("the line turned into the owner's own phone: 'Message yourself' is the owner", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await page.getByRole("button", { name: "Configuración del canal" }).click();
  await page.getByRole("switch", { name: "Esta línea es mi propio teléfono" }).click();
  await expect(page.getByText("Todavía no está vinculado", { exact: false })).toBeHidden();
  await until(async () =>
    (await rpc<{ channels: Array<{ self_owner?: boolean; status: string }> }>("channels.list")).channels.some(
      (c) => c.self_owner && c.status === "running",
    ),
  );
  await world.whatsapp.fromOwner("now from my own phone");
  await until(async () => (await world.whatsapp.sentTo(LINE)).some((t) => t.includes("Got it: now from my own phone")));
});
