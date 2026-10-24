// A channel's contacts (WhatsApp, linked by 10-whatsapp): a saved contact with no chat yet is listed and opens an empty
// chat to ask the agent to write to them; what was sent shows how far it got and their reactions; who is online and what is set for each
// contact show on their row.
import { expect, open, rpc, test, until, world } from "./kit.ts";

const NORA = "5491100000011@s.whatsapp.net";

test("a saved contact with no chat: listed, an empty chat to ask the agent to write, then sent and read", async ({
  page,
}) => {
  const nora = await rpc<{ id: string }>("contacts.set", { name: "Nora" });
  await rpc("contacts.address", { channel: "whatsapp", address: "+54 9 11 0000-0011", person: nora.id });

  await open(page);
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  const row = page.locator(".chan__rows").getByRole("button", { name: /Nora/ });
  await expect(row).toContainText("+5491100000011");
  await row.click();
  await expect(page.getByText("Todavía no hay mensajes con Nora")).toBeVisible();

  // The name in the header opens and closes the contact card.
  const card = page.getByRole("complementary", { name: "Contacto" });
  const wasOpen = await card.isVisible();
  await page.getByRole("button", { name: "Abrir el contacto de Nora" }).click();
  await expect(card).toBeVisible({ visible: !wasOpen });
  if (wasOpen) await page.getByRole("button", { name: "Abrir el contacto de Nora" }).click();
  await expect(card.getByRole("textbox", { name: "Nombre" })).toHaveValue("Nora");
  await card.getByRole("combobox", { name: "Relación" }).click();
  await page.getByRole("option", { name: "Amigo/a" }).click();
  await expect(card.getByRole("combobox", { name: "Relación" })).toContainText("Amigo/a");
  // What each option does is behind the "?", not under every switch.
  await card.getByRole("button", { name: "Sobre qué puede hacer esta conversación" }).hover();
  const help = page.getByRole("dialog", { name: "Sobre qué puede hacer esta conversación" });
  await expect(help.getByText(/queda como tarea y te aviso en el momento/)).toBeVisible();
  await expect(help.getByText(/pareja, familia y amigos siempre pueden dejarte un mensaje/)).toBeVisible();
  await page.keyboard.press("Escape");
  // The owner's own WhatsApp number is linked (10-whatsapp): "This account is mine" is settled, so no card offers it.
  await expect(card.getByRole("textbox", { name: "Nombre" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Esta cuenta es mía" })).toHaveCount(0);
  await expect(card.getByText("Cuidado")).toHaveCount(0);

  const box = page.getByRole("textbox", { name: /que le escriba a Nora/ });
  await box.fill("decile hola a Nora");
  await box.press("Enter");
  await until(async () => (await world.whatsapp.sentTo(NORA)).some((t) => t.startsWith("Got it:")));
  const ticks = page.locator(".chan__bubble.is-out").last();
  await expect(ticks.getByRole("img", { name: "Enviado" })).toBeVisible();
  await world.whatsapp.receipt(NORA, 3);
  await expect(ticks.getByRole("img", { name: "Entregado" })).toBeVisible();
  await world.whatsapp.receipt(NORA, 4);
  await expect(ticks.getByRole("img", { name: "Leído" })).toBeVisible();
  // Their emoji on it shows on the bubble, and goes when they take it off.
  await world.whatsapp.react({ phone: NORA, name: "Nora" }, "❤️");
  await expect(ticks.getByRole("img", { name: "Su reacción: ❤️" })).toBeVisible();
  // Opened from the Inbox it is the same chat as in its channel: their emoji on the answer and how far it got.
  const { threads } = await rpc<{ threads: Array<{ id: string; title: string }> }>("threads.list");
  const chat = threads.find((t) => t.title === "Nora");
  await open(page, `#thread=${chat?.id}`);
  const answer = page.locator(".chan--single .chan__bubble.is-out").last();
  await expect(answer.getByRole("img", { name: "Su reacción: ❤️" })).toBeVisible();
  await expect(answer.getByRole("img", { name: "Leído" })).toBeVisible();
  await world.whatsapp.react({ phone: NORA, name: "Nora" }, "");
  await expect(answer.getByRole("img", { name: /Su reacción/ })).toHaveCount(0);
});

test("who is online and what is set for a contact show on their row", async ({ page }) => {
  const { persons } = await rpc<{ persons: Array<{ id: string; name: string }> }>("contacts.list");
  const nora = persons.find((p) => p.name === "Nora");
  await rpc("contacts.set", { id: nora?.id, name: "Nora", muted: true, perms: { notes: true } });

  await open(page);
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  const row = page.locator(".chan__rows").getByRole("button", { name: /Nora/ });
  await expect(row.getByRole("img", { name: "Silenciado" })).toBeVisible();
  await expect(row.getByRole("img", { name: "Contestar desde mis notas" })).toBeVisible();

  // Listing the contacts asks WhatsApp about them; their phone coming online lights the dot.
  await until(async () => {
    await world.whatsapp.presence(NORA, true);
    return row.getByRole("img", { name: "En línea" }).isVisible();
  });
  await world.whatsapp.presence(NORA, false);
  await expect(row.getByRole("img", { name: "En línea" })).toBeHidden({ timeout: 8000 });
});
