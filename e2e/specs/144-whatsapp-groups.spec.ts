// WhatsApp groups as rooms: picked in the account's Rooms part from the groups the line is in. On the owner's own
// phone they are only read until the owner lets the agent answer there as them; on a line of its own an @mention of
// the line is answered in the group.
import type { Page } from "@playwright/test";
import { ACCOUNT_NAME, expect, open, rpc, test, until, world } from "./kit.ts";

const TEAM = { id: "120363000000000101@g.us", name: "Acme equipo" };
const NEWS = { id: "120363000000000102@g.us", name: "Acme novedades" };
const ANA = { phone: "5491100000021@s.whatsapp.net", name: "Ana" };

type Listed = {
  channels: Array<{
    id: string;
    type: string;
    status: string;
    self_owner?: boolean;
    agent_id: string;
    rooms?: { rooms: Array<{ id: string; mode: string }>; as_owner?: boolean; off?: boolean };
  }>;
};
const line = async () => (await rpc<Listed>("channels.list")).channels.find((c) => c.id === "whatsapp");

/** The line linked and running, as the owner's own phone or as a line of its own (earlier specs may have left either). */
async function lineAs(selfOwner: boolean): Promise<void> {
  const was = await line();
  if (!was) {
    await rpc("channels.set", { id: "whatsapp", channel: { type: "whatsapp", agent_id: "superagent" } });
    await until(async () => (await line())?.status === "starting");
    await world.whatsapp.scan();
  }
  const now = await line();
  if (Boolean(now?.self_owner) !== selfOwner)
    await rpc("channels.set", { id: "whatsapp", channel: { ...now, self_owner: selfOwner } });
  await until(async () => {
    const c = await line();
    return c?.status === "running" && Boolean(c.self_owner) === selfOwner;
  });
}

async function openRooms(page: Page) {
  await open(page, "#view=channels");
  await page.getByRole("button", { name: `Configuración de ${ACCOUNT_NAME.whatsapp}` }).click();
  // The part of the account's own dialog, named as WhatsApp names them.
  const dialog = page.getByRole("dialog", { name: "WhatsApp" });
  await dialog.getByRole("button", { name: /^Grupos/ }).click();
  await expect(dialog.getByRole("heading", { name: "Grupos" })).toBeVisible();
}
const save = (page: Page) => page.getByRole("button", { name: /^Guardar (⌘|Ctrl)/ }).click();

test.beforeAll(async () => {
  await rpc("setup.finish");
  await world.whatsapp.joinGroup(TEAM.id, TEAM.name);
  await world.whatsapp.joinGroup(NEWS.id, NEWS.name, true);
});

test("on the owner's own phone a group is only read until the owner lets the agent answer there as them", async ({
  page,
}) => {
  await lineAs(true);
  await openRooms(page);
  const asOwner = page.getByRole("switch", { name: "Contestar en grupos como yo" });
  await expect(asOwner).not.toBeChecked();
  await expect(page.getByText(/Esta línea es tu propio teléfono: lo que el agente escriba/)).toBeVisible();

  // The groups come from the line; one where only admins write says it cannot write.
  await page.getByRole("combobox", { name: "Sumar un grupo donde está esta línea…" }).click();
  await expect(page.getByRole("option", { name: /Acme novedades/ })).toBeVisible();
  await page.getByRole("option", { name: /Acme equipo/ }).click();
  const mode = page.getByRole("combobox", { name: `Modo de ${TEAM.name}` });
  await expect(mode).toBeDisabled();
  await expect(mode).toHaveText(/Solo leer/);
  await expect(page.getByText(/Tus grupos solo se leen/)).toBeVisible();
  await page.getByRole("textbox", { name: "Cómo lo llaman" }).fill("apx");
  await page.getByRole("textbox", { name: "Cómo lo llaman" }).blur();
  await save(page);
  // A new group list reconnects the line: it hears the group once it runs again.
  await until(async () => {
    const c = await line();
    return c?.status === "running" && c.rooms?.rooms.some((r) => r.id === TEAM.id);
  });

  const calls = await world.llmCalls();
  await world.whatsapp.inGroup(ANA, TEAM.id, "¿alguien sabe la fecha?", true);
  await world.whatsapp.ownerInGroup(TEAM.id, "apx, ¿qué opinás?");
  // Both are kept in the group's chat, and nothing is said as the owner.
  await page.keyboard.press("Escape");
  await open(page);
  await page.getByRole("button", { name: ACCOUNT_NAME.whatsapp, exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp(TEAM.name) })
    .first()
    .click();
  await expect(page.getByText("apx, ¿qué opinás?").last()).toBeVisible();
  await expect(page.getByText("¿alguien sabe la fecha?").last()).toBeVisible();
  // There only the owner writes, from their own number: the agent is not offered to post.
  await expect(page.getByText(/desde tu número\. .+ solo lee este grupo/)).toBeVisible();
  await expect(page.getByRole("radio", { name: /publica$/ })).toHaveCount(0);
  await new Promise((r) => setTimeout(r, 300));
  expect(await world.whatsapp.sentTo(TEAM.id)).toEqual([]);
  expect(await world.llmCalls()).toBe(calls);

  // Allowed: the owner calling it by name in the group is answered there, from their number.
  await openRooms(page);
  await page.getByRole("switch", { name: "Contestar en grupos como yo" }).click();
  await expect(page.getByText(/Tus grupos solo se leen/)).toBeHidden();
  await expect(page.getByRole("combobox", { name: `Modo de ${TEAM.name}` })).toBeEnabled();
  await save(page);
  await until(async () => (await line())?.rooms?.as_owner === true);
  await world.whatsapp.ownerInGroup(TEAM.id, "apx, ¿cuándo sale la beta?");
  await until(async () => (await world.whatsapp.sentTo(TEAM.id)).some((t) => t.startsWith("Got it")));
});

test("on a line of its own, an @mention of the line in a listed group is answered in the group", async () => {
  await lineAs(false);
  const before = (await world.whatsapp.sentTo(TEAM.id)).length;
  await world.whatsapp.inGroup(ANA, TEAM.id, "¿cómo instalo la app?", true);
  await until(async () => (await world.whatsapp.sentTo(TEAM.id)).length > before);
  expect(await world.whatsapp.sentTo(ANA.phone)).toEqual([]);
});

test("with groups and rooms turned off a listed group is dropped, and the list comes back when they are on again", async ({
  page,
}) => {
  await lineAs(false);
  await openRooms(page);
  const on = page.getByRole("switch", { name: "Usar grupos" });
  await expect(on).toBeChecked();
  await on.click();
  await expect(page.getByText(/Apagado, todo lo que llega de ellos se descarta/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: `Modo de ${TEAM.name}` })).toBeHidden();
  await save(page);
  await until(async () => (await line())?.rooms?.off === true);

  const before = (await world.whatsapp.sentTo(TEAM.id)).length;
  const calls = await world.llmCalls();
  await world.whatsapp.inGroup(ANA, TEAM.id, "¿hay alguien leyendo?", true);
  await new Promise((r) => setTimeout(r, 300));
  expect((await world.whatsapp.sentTo(TEAM.id)).length).toBe(before);
  expect(await world.llmCalls()).toBe(calls);

  await on.click();
  await expect(page.getByRole("combobox", { name: `Modo de ${TEAM.name}` })).toBeVisible();
  await save(page);
  await until(async () => (await line())?.rooms?.off === false);
});
