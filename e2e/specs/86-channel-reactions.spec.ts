// A contact's sticker and the agent's reaction to it: the emoji in sight on the picture (never under it), the Inbox
// saying it reacted instead of the signal, and the chat opened from the Inbox reading as it does in its channel.
import { expect, open, rpc, test, until, world } from "./kit.ts";

const OLGA = { phone: "5491100000012@s.whatsapp.net", name: "Olga" };
// A 1×1 WebP, the file a WhatsApp sticker is.
const WEBP = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

test("the agent reacts to a sticker: the emoji shows on it, and the Inbox says so and opens the channel's chat", async ({
  page,
}) => {
  const olga = await rpc<{ id: string }>("contacts.set", { name: "Olga" });
  await rpc("contacts.address", { channel: "whatsapp", address: "+54 9 11 0000-0012", person: olga.id });
  await world.whatsapp.message(OLGA, "hola!");
  await until(async () => (await world.whatsapp.sentTo(OLGA.phone)).length > 0);
  await world.whatsapp.media(OLGA, { stickerMessage: { mimetype: "image/webp" }, bytes: WEBP });

  await open(page);
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await page.locator(".chan__rows").getByRole("button", { name: /Olga/ }).click();
  const sticker = page
    .locator(".chan__bubble")
    .filter({ has: page.locator("img") })
    .last();
  await expect(sticker).toBeVisible();
  // What it means is for the agent: beside the picture it never shows as words.
  await expect(page.getByText(/\[sticker/)).toHaveCount(0);
  const box = page.getByRole("textbox", { name: /qué contestarle a Olga/ });
  await box.fill("react with a heart to her sticker");
  await box.press("Enter");

  const heart = sticker.getByRole("img", { name: /^Reacción de .+: ❤️$/ });
  await expect(heart).toBeVisible();
  // Nothing covers it: the topmost element at its center is the emoji itself.
  const covered = await heart.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !el.closest(".chan__reactions")?.contains(top);
  });
  expect(covered).toBe(false);
  expect(await world.whatsapp.sentTo(OLGA.phone)).not.toContain("REACT ❤️");

  // The Inbox says what the agent did, not the signal it wrote.
  const { threads } = await rpc<{ threads: Array<{ id: string; title: string; preview: string }> }>("threads.list");
  const chat = threads.find((t) => t.title === "Olga");
  expect(chat?.preview).toBe("Reaccionó con ❤️");
  // Opened from the Inbox, the chat is the channel's: who answers, the sticker with the emoji on it, the card.
  await open(page, `#thread=${chat?.id}`);
  await page.getByRole("radio", { name: "Por chat" }).click();
  await expect(page.getByText("Reaccionó con ❤️").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: /qué contestarle a Olga/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Escribo yo" })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Reacción de .+: ❤️$/ })).toBeVisible();
  await expect(page.locator(".turn")).toHaveCount(0);
});

test("the channel's settings list the stickers kept: one no model saw waits; the owner names and approves it", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await page.getByRole("button", { name: "Configuración del canal" }).click();
  await expect(page.getByText("Stickers", { exact: true })).toBeVisible();
  // New ones are the agent's by default; this one no model could see, so it waits for the owner.
  await expect(page.getByRole("switch", { name: "Aprobar stickers nuevos automáticamente" })).toBeChecked();
  await expect(page.getByText("Esperando tu OK")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Puede usarlo" }).first()).not.toBeChecked();
  const meaning = page.getByRole("textbox", { name: "Qué significa" }).first();
  await meaning.scrollIntoViewIfNeeded();
  await meaning.fill("mate compartido, buena onda");
  await meaning.press("Enter");
  await page.getByRole("switch", { name: "Puede usarlo" }).first().click();
  await page.screenshot({ path: "test-results/86-stickers-settings.png" });
  const kept = async () =>
    (
      await rpc<{ stickers: Array<{ meaning?: string; blocked: boolean; pending: boolean }> }>("stickers.list", {
        platform: "whatsapp",
      })
    ).stickers;
  await expect(page.getByText("Esperando tu OK")).toHaveCount(0);
  await until(async () =>
    (await kept()).some((s) => s.meaning === "mate compartido, buena onda" && !s.blocked && !s.pending),
  );
});
