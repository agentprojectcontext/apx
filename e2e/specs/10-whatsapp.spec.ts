// WhatsApp, emulated: a line of its own linked with the QR, the owner's phone linked by writing to it, strangers asked
// about on the owner's phone, and the line turned into the owner's own phone ("Message yourself").
import { expect, open, rpc, test, until, world } from "./kit.ts";

// Done with the setup wizard: this spec must not depend on an earlier one having finished it.
test.beforeAll(async () => {
  await rpc("setup.finish");
});

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
  // Both channels write into Home: WhatsApp's view of it shows only what was said there, Home shows it all.
  const chat = page.getByRole("main");
  await expect(chat.getByText("Got it: Remind me to call the bank").first()).toBeVisible();
  await expect(chat.getByText("Remind me to stretch")).toHaveCount(0);
  await expect(chat.getByText(/Solo lo que hablaron vos y .+ por WhatsApp/)).toBeVisible();
  await chat.getByRole("button", { name: "Abrir Home" }).click();
  await expect(page.getByRole("main").getByText("Remind me to stretch").first()).toBeVisible();
  await expect(page.getByRole("main").getByText("Remind me to call the bank").first()).toBeVisible();
});

test("strangers 'ask me': whoever writes is an unreviewed contact, the owner hears who and what; unsilenced, they get answers", async ({
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

  // In the panel they are a contact not reviewed yet: their message is in their chat, unanswered.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Lucía.*Sin revisar/ }).click();
  await expect(page.getByText("hola, ¿vamos el sábado?").last()).toBeVisible();
  await page.getByRole("button", { name: "Quitar silencio" }).click();
  await world.whatsapp.message(FRIEND, "¿y a qué hora?");
  await until(async () => (await world.whatsapp.sentTo(FRIEND.phone)).some((t) => t.startsWith("Got it:")));
});

test("a contact's video plays in the chat's own player, and a document of any type downloads", async ({ page }) => {
  const mp4 = Buffer.concat([Buffer.from("000000186674797069736f6d", "hex"), Buffer.alloc(64 * 1024, 1)]);
  await world.whatsapp.media(FRIEND, {
    videoMessage: { caption: "Mirá cómo quedó", mimetype: "video/mp4", fileLength: mp4.length },
    bytes: mp4.toString("base64"),
  });
  await world.whatsapp.media(FRIEND, {
    documentMessage: { fileName: "planilla.ods", mimetype: "application/vnd.oasis.opendocument.spreadsheet" },
    bytes: Buffer.from("PK\u0003\u0004 hoja").toString("base64"),
  });
  await open(page);
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await page.getByRole("button", { name: /Lucía/ }).first().click();
  await expect(page.locator('video[aria-label="video.mp4"]')).toBeVisible();
  await expect(page.getByText("Mirá cómo quedó")).toBeVisible();
  await expect(page.getByRole("button", { name: /planilla\.ods/ })).toBeVisible();
  await expect(page.getByText("[attached files]")).toHaveCount(0);
  await expect(page.getByText(/cannot read this kind/)).toHaveCount(0);
});

test("a video kept only as a placeholder: 'Recover files' asks the phone again and it plays in the chat", async ({
  page,
}) => {
  const mp4 = Buffer.concat([Buffer.from("000000186674797069736f6d", "hex"), Buffer.alloc(32 * 1024, 2)]);
  // What APX kept of a video before it read media: the words only. The phone still has the video.
  const answers = (await world.whatsapp.sentTo(FRIEND.phone)).length;
  const id = await world.whatsapp.message(FRIEND, "[video — APX cannot read this kind of message yet]");
  await until(async () => (await world.whatsapp.sentTo(FRIEND.phone)).length > answers);
  await world.whatsapp.keep(id, { videoMessage: { mimetype: "video/mp4" }, bytes: mp4.toString("base64") });
  await open(page);
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await page.getByRole("button", { name: /Lucía/ }).first().click();
  await expect(page.getByText(/cannot read this kind/)).toBeVisible();
  const calls = await world.llmCalls();

  await page.getByRole("button", { name: "Recuperar archivos" }).click();
  await expect(page.getByText("Se recuperaron 1 de 1 archivos")).toBeVisible();
  await expect(page.locator('video[aria-label="video.mp4"]').last()).toBeVisible();
  await expect(page.getByText(/cannot read this kind/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Recuperar archivos" })).toHaveCount(0);
  expect(await world.llmCalls()).toBe(calls);
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
