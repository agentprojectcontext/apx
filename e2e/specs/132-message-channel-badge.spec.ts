// A message that came in or went out on a chat app shows that app's mark in Home, so the owner knows it reached their
// phone too; the owner's own Telegram is the one linked in the setup (06-telegram), emulated.
import { expect, open, rpc, test, until, world } from "./kit.ts";

const owner = { id: 4242, name: "Ana" };
type Channel = { id: string; type: string; owner_thread: "home" | "own" };

test("what the owner wrote on Telegram and the answer sent there carry Telegram's mark in Home", async ({ page }) => {
  const tg = (await rpc<{ channels: Channel[] }>("channels.list")).channels.find((c) => c.type === "telegram");
  // The owner's Telegram writes into Home (the channel's default): one conversation in the app and on the phone.
  expect(tg?.owner_thread).toBe("home");
  await world.telegram(owner, "Badge check from my phone");
  await until(async () =>
    (await world.sentTo(owner.id)).some((m) => m.text?.includes("Got it: Badge check from my phone")),
  );
  await rpc("threads.send", { thread: "home", text: "Badge check from the app" });

  await open(page, "#thread=home");
  const main = page.getByRole("main");
  const asked = main.locator(".apx-msg--user").filter({ hasText: "Badge check from my phone" }).last();
  await expect(asked.getByRole("img", { name: /^Llegó por / })).toBeVisible();
  const answer = main.locator(".apx-msg").filter({ hasText: "Got it: Badge check from my phone" }).last();
  await expect(answer.getByRole("img", { name: /^Enviado por / })).toBeVisible();
  // What the owner wrote in the app stayed in the app: no mark.
  const here = main.locator(".apx-msg--user").filter({ hasText: "Badge check from the app" }).last();
  await expect(here).toBeVisible();
  await expect(here.getByRole("img", { name: /^(Llegó|Enviado) por / })).toHaveCount(0);
});
