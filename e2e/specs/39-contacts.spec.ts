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

  // A contact nobody wrote to has no chat yet: the channel's own screen lists them (as the account's Inbox list does).
  await open(page, "#channel=whatsapp");
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
  const relation = card.getByRole("combobox", { name: "Relación" });
  await relation.click();
  await page.getByRole("option", { name: "Amigo/a" }).click();
  await expect(relation).toContainText("Amigo/a");
  // What each option does reads under its switch, and the closing note about family and friends under them.
  await expect(card.getByText(/queda como tarea y te aviso en el momento/)).toBeVisible();
  await expect(card.getByText(/pareja, familia y amigos siempre pueden dejarte un mensaje/)).toBeVisible();
  // Each right follows the account unless set here: taking requests becomes Nora's own.
  const requests = card.getByRole("radiogroup", { name: "Tomar pedidos", exact: true });
  await expect(requests.getByRole("radio", { name: "Cuenta: No" })).toBeChecked();
  await requests.getByRole("radio", { name: "Sí" }).click();
  await card.getByRole("button", { name: "Guardar" }).click();
  await until(async () => {
    const { persons } = await rpc<{ persons: Array<{ name: string; perms: { requests?: boolean } }> }>("contacts.list");
    return persons.find((p) => p.name === "Nora")?.perms.requests === true;
  });
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
  // Loaded straight into the Inbox, never through its channel, the chat still comes with its styles.
  await page.reload();
  await expect(answer).toBeVisible();
  expect(await answer.evaluate((el) => getComputedStyle(el).display)).toBe("flex");
});

test("who is online and what is set for a contact show on their row", async ({ page }) => {
  const { persons } = await rpc<{ persons: Array<{ id: string; name: string }> }>("contacts.list");
  const nora = persons.find((p) => p.name === "Nora");
  await rpc("contacts.set", { id: nora?.id, name: "Nora", muted: true, perms: { notes: true } });

  // A contact nobody wrote to has no chat in the Inbox: the channel's own screen lists them.
  await open(page, "#channel=whatsapp");
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

test("a muted, supervised contact: switches on their card, marks under their name, and the whole header opens it", async ({
  page,
}) => {
  const { persons } = await rpc<{ persons: Array<{ id: string; name: string }> }>("contacts.list");
  const nora = persons.find((p) => p.name === "Nora");
  await rpc("contacts.set", { id: nora?.id, name: "Nora", muted: true, supervised: true });

  // A contact nobody wrote to has no chat in the Inbox: the channel's own screen lists them.
  await open(page, "#channel=whatsapp");
  await page.locator(".chan__rows").getByRole("button", { name: /Nora/ }).click();
  const header = page.getByRole("button", { name: "Abrir el contacto de Nora" });
  await expect(header.getByRole("img", { name: "Silenciado" })).toBeVisible();
  await expect(header.getByRole("img", { name: /^Supervisado/ })).toBeVisible();
  // The name's bar is the one way to the card: no separate Contact button.
  await expect(page.locator(".chan__chathead").getByRole("button", { name: "Contacto", exact: true })).toHaveCount(0);
  const card = page.getByRole("complementary", { name: "Contacto" });
  if (!(await card.isVisible())) await header.click();
  const muted = card.getByRole("switch", { name: /^Silenciado/ });
  await expect(muted).toBeChecked();
  await expect(card.getByRole("switch", { name: /^Supervisar/ })).toBeChecked();
  const save = await card.getByRole("button", { name: "Guardar" }).boundingBox();
  const edge = await card.boundingBox();
  expect(save && edge && save.x + save.width <= edge.x + edge.width).toBe(true);
  // A switch applies at once, with no Save.
  await muted.click();
  await expect(muted).not.toBeChecked();
  await until(async () => {
    const { persons } = await rpc<{ persons: Array<{ name: string; muted?: boolean }> }>("contacts.list");
    return persons.find((p) => p.name === "Nora")?.muted === false;
  });
  await expect(header.getByRole("img", { name: "Silenciado" })).toHaveCount(0);
});
