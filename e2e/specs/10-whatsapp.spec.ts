// WhatsApp, emulated as the owner's phone: link the number with the QR, talk to the agent in "Message yourself", and a
// friend who writes is only listed until the owner lets them in.
import { expect, open, rpc, test, until, world } from "./kit.ts";

const OWNER = "5491100000001@s.whatsapp.net";
const FRIEND = { phone: "5491100000009@s.whatsapp.net", name: "Lucía" };

test("the owner links WhatsApp with the QR and talks to the agent in 'Message yourself'", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Agregar canal" }).click();
  await page.getByRole("menuitem", { name: /WhatsApp/ }).click();
  await page.getByRole("button", { name: "Vincular" }).click();
  await expect(page.getByRole("img", { name: "Escaneá este código con tu teléfono" })).toBeVisible();

  await world.whatsapp.scan();
  await expect(page.getByText("+5491100000001").first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Escaneá este código con tu teléfono" })).toBeHidden();

  await world.whatsapp.fromOwner("Remind me to call the bank");
  await until(async () =>
    (await world.whatsapp.sentTo(OWNER)).some((t) => t.includes("Got it: Remind me to call the bank")),
  );
});

test("a friend writing is listed, never answered, until the owner lets them in", async ({ page }) => {
  const calls = await world.llmCalls();
  await world.whatsapp.message(FRIEND, "hola, ¿vamos el sábado?");
  await until(async () =>
    (await rpc<{ requests: Array<{ name: string }> }>("pairing.list")).requests.some((r) => r.name === "Lucía"),
  );
  expect(await world.whatsapp.sentTo(FRIEND.phone)).toEqual([]);
  expect(await world.llmCalls()).toBe(calls);

  await open(page);
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await expect(page.getByText("“hola, ¿vamos el sábado?”")).toBeVisible();
  await expect(page.getByRole("button", { name: "Soy yo" })).toBeHidden();
  await page
    .getByRole("button", { name: /Aceptar/ })
    .first()
    .click();
  await expect(page.getByText("“hola, ¿vamos el sábado?”")).toBeHidden();

  await world.whatsapp.message(FRIEND, "¿estás?");
  await until(async () => (await world.whatsapp.sentTo(FRIEND.phone)).some((t) => t.startsWith("Got it:")));
  await expect(page.getByRole("button", { name: /^Vos “Mensaje a mí mismo”/ })).toBeVisible();
});
