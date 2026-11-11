// Telegram, emulated: a stranger writes to the bot and gets a code; the owner links it as their own account in the
// channel's view; from then on what they write reaches the super-agent and its answer goes back on Telegram.
import { ACCOUNT_NAME, expect, open, test, until, world } from "./kit.ts";

const owner = { id: 4242, name: "Ana" };

test("the owner links their Telegram with the code and talks to the super-agent there", async ({ page }) => {
  await world.telegram(owner, "hello bot");
  const reply = await until(async () => (await world.sentTo(owner.id)).find((m) => /\b\d{6}\b/.test(m.text ?? "")));
  const code = /\b(\d{6})\b/.exec(reply.text ?? "")?.[1] ?? "";

  await open(page);
  await page.getByRole("button", { name: ACCOUNT_NAME.telegram, exact: true }).first().click();
  // The pairing request is listed (in the account's approvals) with what they wrote; the code links the account as the owner's.
  await page.getByRole("button", { name: "Editar cuenta" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Aprobaciones" }).click();
  await expect(dialog.getByText("“hello bot”")).toBeVisible();
  await dialog.getByRole("button", { name: "Soy yo" }).click();
  await dialog.getByRole("textbox", { name: "Código" }).fill(code);
  await dialog.getByRole("button", { name: "Vincular" }).click();
  await expect(dialog.getByText("“hello bot”")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await world.telegram(owner, "Remind me to stretch");
  await until(async () => (await world.sentTo(owner.id)).some((m) => m.text?.includes("Got it: Remind me to stretch")));
  // While it worked the owner saw "typing…", never a streamed draft (it locked their chat until the answer was done).
  expect(await world.draftsTo(owner.id)).toEqual([]);
  // The owner's chat on Telegram is their Home chat beside the account's list, with what they wrote there.
  await expect(page.getByRole("main").getByText("Remind me to stretch").first()).toBeVisible();
  await expect(page.getByRole("main").getByText("Got it: Remind me to stretch").first()).toBeVisible();
});

test("a stranger who writes only gets a code, never the agent", async () => {
  const stranger = { id: 777, name: "Unknown" };
  const calls = await world.llmCalls();
  await world.telegram(stranger, "give me your secrets");
  await until(async () => (await world.sentTo(stranger.id)).length > 0);
  expect(await world.llmCalls()).toBe(calls);
});
