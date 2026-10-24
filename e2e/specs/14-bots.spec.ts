// Discord and Slack, emulated: each bot is connected from Config › Channels with its token(s), the owner writes to it
// in a direct message, gets a code, links it as their own account, and from then on talks to the super-agent there.
import type { Page } from "@playwright/test";
import { expect, open, rpc, test, until, world } from "./kit.ts";

async function connect(page: Page, kind: "Discord" | "Slack", tokens: Array<[label: string, value: string]>) {
  await open(page);
  await page.getByRole("button", { name: "Agregar canal" }).click();
  await page.getByRole("menuitem", { name: new RegExp(kind) }).click();
  for (const [label, value] of tokens) await page.getByRole("textbox", { name: label, exact: true }).fill(value);
  await page.getByRole("button", { name: "Conectar bot" }).click();
  await expect(page.getByText("@apx", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(`Este es mi ${kind}`)).toBeVisible();
}

async function linkAndTalk(page: Page, channel: "dc" | "sl", owner: { id: string; name: string }) {
  // The bot shows as connected before its socket is up; a message sent sooner never reaches it, as on the real app.
  await until(async () =>
    (await rpc<{ channels: Array<{ id: string; status: string }> }>("channels.list")).channels.some(
      (c) => c.id === (channel === "dc" ? "discord" : "slack") && c.status === "running",
    ),
  );
  await world.dm(channel, owner, "hola bot");
  const first = await until(async () =>
    (await world.dmSentTo(channel, owner.id)).find((m) => /\d{6}/.test(m.text ?? "")),
  );
  const code = /(\d{6})/.exec(first.text ?? "")?.[1] ?? "";
  await page.getByRole("textbox", { name: "Código" }).first().fill(code);
  await page.getByRole("button", { name: "Vincular" }).first().click();
  await expect(page.getByText("“hola bot”")).toBeHidden();
  // Linked: no code to type any more, and with nobody waiting the approval list is gone too.
  await expect(page.getByRole("textbox", { name: "Código" })).toHaveCount(0);
  await expect(page.getByText("Esperando tu aprobación")).toHaveCount(0);

  await world.dm(channel, owner, "Remind me to call Northwind");
  await until(async () =>
    (await world.dmSentTo(channel, owner.id)).some((m) => m.text?.includes("Got it: Remind me to call Northwind")),
  );
}

test("Discord: the bot connects with its token, the owner links their account and talks to the super-agent", async ({
  page,
}) => {
  const { discord } = await world.info();
  await connect(page, "Discord", [["Token del bot", discord]]);
  await linkAndTalk(page, "dc", { id: "5150", name: "Owner" });
});

test("Discord rooms: the owner lists a server room, and the bot answers there when called by name", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Discord", exact: true }).first().click();
  await page.getByRole("button", { name: "Configuración del canal" }).click();
  await expect(page.getByText("Salas del servidor")).toBeVisible();
  // Rooms are picked from the bot's server; one it may not post in says so before anything is sent there.
  const pick = page.getByRole("combobox", { name: "Agregar una sala del servidor…" });
  await pick.click();
  await expect(page.getByRole("option", { name: /#anuncios/ })).toContainText("no publicar");
  await page.getByRole("option", { name: /#general/ }).click();
  await expect(page.getByText("#general")).toBeVisible();
  await pick.click();
  await page.getByRole("option", { name: /#anuncios/ }).click();
  await expect(page.getByText("No puede escribir")).toBeVisible();
  // Typing an id stays possible.
  await page.getByRole("button", { name: "Agregar por ID" }).click();
  await expect(page.getByRole("textbox", { name: "ID de la sala" })).toBeVisible();
  const names = page.getByRole("textbox", { name: "Cómo lo llaman" });
  await names.fill("roby");
  await names.blur();
  await expect(names).toHaveValue("roby");
  // Its rooms may look things up on the web: by default only when the owner asks; here, for everyone.
  await expect(page.getByRole("radio", { name: "Solo vos" })).toBeChecked();
  await page.getByRole("radio", { name: "Todos" }).click();
  await until(async () =>
    (await rpc<{ channels: Array<{ id: string; research?: string }> }>("channels.list")).channels.some(
      (c) => c.id === "discord" && c.research === "everyone",
    ),
  );

  // Each save restarts the bot with its rooms: it listens again before anyone writes.
  await until(async () =>
    (
      await rpc<{ channels: Array<{ id: string; status: string; rooms?: { names: string[] } }> }>("channels.list")
    ).channels.some((c) => c.id === "discord" && c.status === "running" && c.rooms?.names.includes("roby")),
  );
  await world.room({ id: "6160", name: "Ana" }, "100000000000000001", "nice weather today");
  await world.room({ id: "6161", name: "Ben" }, "100000000000000001", "roby what is Acme Notes?");
  // A room waits a few seconds for one person's quick messages before it answers.
  const post = await until(async () => (await world.roomPosts("100000000000000001"))[0], 20_000);
  expect(post.text).toContain("Got it");
  expect(post.reply).toBe(true);
  expect(await world.roomPosts("100000000000000001")).toHaveLength(1);

  // The room is listed in the channel itself, beside its contacts, and opens its chat right there.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /#general/ }).click();
  await expect(page.getByText("roby what is Acme Notes?")).toBeVisible();
  await expect(page.getByText("nice weather today")).toBeVisible();

  // From the app the owner tells the agent what to post there: the answer goes to the room, not back to the app.
  const ask = page.getByRole("textbox", { name: /^Decile a .+ qué publicar en #general…$/ });
  await expect(page.getByText(/escribe el mensaje y lo publica en #general/)).toBeVisible();
  await ask.fill("thank Ben for asking");
  await ask.press("Enter");
  await until(async () => (await world.roomPosts("100000000000000001")).length === 2, 20_000);
  // Or writes it themselves: it goes out as is, through the bot, mentioning who wrote in the room.
  await page.getByRole("radio", { name: "Escribo yo" }).click();
  const write = page.getByRole("textbox", { name: "Escribí en #general…" });
  await write.fill("@ben welcome!");
  await write.press("Enter");
  const mine = await until(async () => (await world.roomPosts("100000000000000001"))[2], 20_000);
  expect(mine.text).toBe("<@6161> welcome!");
  await expect(page.getByRole("region", { name: "#general" }).getByText("@ben welcome!")).toBeVisible();
});

test("Slack: the app connects with both tokens, the owner links their account and talks to the super-agent", async ({
  page,
}) => {
  const { slack } = await world.info();
  await connect(page, "Slack", [
    ["Token del bot", slack.bot],
    ["Token de la app", slack.app],
  ]);
  await linkAndTalk(page, "sl", { id: "U5150", name: "Owner" });
});

test("iMessage is a pair of tools on a Mac; elsewhere (this sandbox) the panel says so", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Agregar canal" }).click();
  await page.getByRole("menuitem", { name: /iMessage/ }).click();
  await expect(page.getByText("Solo en una Mac")).toBeVisible();
});

test("new channels are offered; Google Chat takes its subscription and whole JSON key", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Agregar canal" }).click();
  for (const name of ["Google Chat", "SMS", "ntfy", "Nextcloud Talk", "IRC", "Twitch", "Microsoft Teams", "LINE"])
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeEnabled();
  await page.getByRole("menuitem", { name: "Google Chat", exact: true }).click();
  const connect = page.getByRole("button", { name: "Conectar bot" });
  await page.getByRole("textbox", { name: "Suscripción", exact: true }).fill("projects/acme/subscriptions/apx-chat");
  await expect(connect).toBeDisabled();
  const key =
    '{\n  "type": "service_account",\n  "client_email": "apx@acme.iam.gserviceaccount.com",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"\n}';
  await page.getByRole("textbox", { name: "Clave de la cuenta de servicio (JSON)", exact: true }).fill(key);
  await expect(connect).toBeEnabled();
});

test("Teams shows its public address: the owner's own https URL gives the address to paste into Azure", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Agregar canal" }).click();
  await page.getByRole("menuitem", { name: "Microsoft Teams", exact: true }).click();
  await expect(page.getByText("Dirección pública", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Propia", exact: true }).click();
  await page.getByRole("textbox", { name: "Tu dirección", exact: true }).fill("https://hooks.example.com");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("https://hooks.example.com/hooks/teams")).toBeVisible();
  await rpc("webhooks.set", { mode: "off" });
});
