// A Discord account's Contacts lists the people who wrote in its rooms: the owner gives one a relation right from the
// list (kept as a contact nobody answers until approved), marks another's account as their own and takes it back.
import type { Person } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test, until, world } from "./kit.ts";

const GENERAL = "100000000000000001";
const ANA = { id: "7160", name: "Ana" };
const BEN = { id: "7161", name: "Ben" };

type Seen = { address: string; person_id?: string };

test("room speakers are the account's contacts; the owner marks one as themself and takes it back", async ({
  page,
}) => {
  const { discord } = await world.info();
  await rpc("channels.set", {
    id: "community",
    channel: {
      type: "discord",
      label: "Acme Community",
      agent_id: "superagent",
      rooms: { rooms: [{ id: GENERAL, name: "general", mode: "read" }], names: ["roby"] },
    },
    token: discord,
  });
  await until(async () =>
    (await rpc<{ channels: Array<{ id: string; status: string }> }>("channels.list")).channels.some(
      (c) => c.id === "community" && c.status === "running",
    ),
  );
  await world.room(ANA, GENERAL, "hola a todos");
  await world.room(BEN, GENERAL, "how do I install it?");
  await until(async () => (await rpc<{ seen: Seen[] }>("contacts.seen", { channel: "community" })).seen.length === 2);

  await open(page);
  await page.getByRole("button", { name: "Acme Community", exact: true }).first().click();
  await page.getByRole("button", { name: "Editar cuenta" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Contactos/ }).click();
  // Both are listed with where they wrote, and counted, though neither was approved.
  await expect(dialog.getByRole("button", { name: /^Contactos\s*2$/ })).toBeVisible();
  const row = (who: string) => dialog.locator(".acct__trow", { hasText: who });
  await expect(row("@ana")).toContainText(ANA.id);
  await expect(row("@ben")).toBeVisible();
  await page.screenshot({ path: "test-results/room-contacts.png" });

  // A relation from the list keeps Ben as a contact, still unreviewed: nobody answers him for it.
  await dialog.getByRole("combobox", { name: "Relación con @ben" }).click();
  await page.getByRole("option", { name: "Cliente", exact: true }).click();
  const ben = await until(async () =>
    (await rpc<{ persons: Person[] }>("contacts.list")).persons.find((p) =>
      p.addresses.some((a) => a.channel === "community" && a.external_id === BEN.id),
    ),
  );
  expect(ben.relation).toBe("client");
  expect(ben.unreviewed).toBe(true);
  await expect(dialog.getByRole("combobox", { name: "Relación con @ben" })).toContainText("Cliente");

  // Ana's account is the owner's: asked first, then it reads as "you", saying how APX knows.
  await row("@ana").getByRole("button", { name: "Más" }).click();
  await page.getByRole("menuitem", { name: "Esta cuenta es mía" }).click();
  await expect(page.getByRole("dialog", { name: "¿Esta cuenta es tuya?" })).toBeVisible();
  await page.getByRole("button", { name: "Sí, es mía" }).click();
  const me = row(`APX te reconoce por ${ANA.id}`);
  await expect(me).toBeVisible();
  await expect(me).toContainText("Vos");
  const owner = await rpc<{ persons: Person[] }>("contacts.list");
  expect(owner.persons.find((p) => p.role === "owner")?.addresses.some((a) => a.external_id === ANA.id)).toBe(true);
  await page.screenshot({ path: "test-results/room-contacts-mine.png" });

  // Taken back: asked first, then Ana is a contact again, not reviewed.
  await me.getByRole("button", { name: "Más" }).click();
  await page.getByRole("menuitem", { name: "Esta cuenta no es mía" }).click();
  await expect(page.getByRole("dialog", { name: "¿Esta cuenta no es tuya?" })).toBeVisible();
  await page.getByRole("button", { name: "No es mía" }).click();
  await expect(me).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: "Relación con @ana" })).toBeVisible();
  const after = await rpc<{ persons: Person[] }>("contacts.list");
  const ana = after.persons.find((p) => p.addresses.some((a) => a.external_id === ANA.id));
  expect(ana?.role).toBe("contact");
  expect(ana?.unreviewed).toBe(true);

  // On a phone the relation stays settable beside each name, with nothing wider than the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole("combobox", { name: "Relación con @ana" })).toBeVisible();
  await page.screenshot({ path: "test-results/room-contacts-phone.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

  await rpc("channels.set", { id: "community", channel: null });
});
