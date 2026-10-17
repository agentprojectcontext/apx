// Telegram groups, emulated: the bot learns the groups it is in from what arrives (Telegram cannot list them), the
// owner picks one in the channel's settings, and from then on the bot reads it and answers there when @mentioned.
import { expect, open, rpc, test, until, world } from "./kit.ts";

const group = { id: -1001234500001, title: "Acme team" };
const ana = { id: 6262, name: "Ana", username: "ana_acme" };
type Channels = {
  channels: Array<{ type: string; status: string; rooms?: { rooms: Array<{ id: string; mode: string }> } }>;
};

test("Telegram groups: a group the bot is in is picked from the list, and the bot answers there when @mentioned", async ({
  page,
}) => {
  // A group nobody listed yet: kept out, but now offered to pick.
  await world.telegramGroup(ana, group, "is the bot here?");
  await open(page);
  await page.getByRole("button", { name: "Telegram", exact: true }).first().click();
  await page.getByRole("button", { name: "Configuración del canal" }).click();
  await expect(page.getByText("Grupos", { exact: true })).toBeVisible();
  await expect(page.getByText(/Group Privacy/)).toBeVisible();
  const pick = page.getByRole("combobox", { name: "Agregar un grupo donde está el bot…" });
  await pick.click();
  await page.getByRole("option", { name: "Acme team" }).click();
  await expect(page.getByText("Acme team", { exact: true })).toBeVisible();
  expect(await world.sentTo(group.id)).toEqual([]);

  // The save restarts the bot with the group: it listens again before anyone writes.
  await until(async () =>
    (await rpc<Channels>("channels.list")).channels.some(
      (c) =>
        c.type === "telegram" &&
        c.status === "running" &&
        c.rooms?.rooms.some((r) => r.id === String(group.id) && r.mode === "mention"),
    ),
  );
  await world.telegramGroup(ana, group, "anyone around today?");
  await world.telegramGroup(ana, group, "@apx_test_bot what is Acme Notes?", "@apx_test_bot");
  // A group waits a few seconds for one person's quick messages before it answers; only the @mention gets one.
  const post = await until(async () => (await world.sentTo(group.id))[0], 20_000);
  expect(post.text).toContain("Got it");
  expect(await world.sentTo(group.id)).toHaveLength(1);
  expect(await world.sentTo(ana.id)).toEqual([]);

  // The group is listed in the channel itself and opens its chat there, with what was said.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Acme team/ }).click();
  await expect(page.getByText("anyone around today?")).toBeVisible();
});
