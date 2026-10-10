// Telegram, emulated: a stranger writes to the bot and gets a code; the owner links it as their own account in the
// channel's view; from then on what they write reaches the super-agent and its answer goes back on Telegram.
import { expect, open, test, until, world } from "./kit.ts";

const owner = { id: 4242, name: "Ana" };

test("the owner links their Telegram with the code and talks to the super-agent there", async ({ page }) => {
  await world.telegram(owner, "hello bot");
  const reply = await until(async () => (await world.sentTo(owner.id)).find((m) => /\b\d{6}\b/.test(m.text ?? "")));
  const code = /\b(\d{6})\b/.exec(reply.text ?? "")?.[1] ?? "";

  await open(page);
  await page.getByRole("button", { name: "Telegram", exact: true }).first().click();
  // The pairing request is listed with what they wrote; the code links the account as the owner's.
  await expect(page.getByText("“hello bot”")).toBeVisible();
  await page.getByRole("textbox", { name: "Código" }).first().fill(code);
  await page.getByRole("button", { name: "Vincular" }).first().click();
  await expect(page.getByText("“hello bot”")).toBeHidden();

  await world.telegram(owner, "Remind me to stretch");
  await until(async () => (await world.sentTo(owner.id)).some((m) => m.text?.includes("Got it: Remind me to stretch")));
  // While it worked the owner saw "typing…", never a streamed draft (it locked their chat until the answer was done).
  expect(await world.draftsTo(owner.id)).toEqual([]);
  // The owner's own chat with the bot opens beside the list, with what they wrote there.
  await page.getByRole("button", { name: /^Vos/ }).click();
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
