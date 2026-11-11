// Discord and Slack, emulated: each bot is connected from Channels › New channel with its token(s), the owner writes to it
// in a direct message, gets a code, links it as their own account, and from then on talks to the super-agent there.
import type { Page } from "@playwright/test";
import { ACCOUNT_NAME, expect, open, rpc, test, until, world } from "./kit.ts";

async function connect(page: Page, kind: "Discord" | "Slack", tokens: Array<[label: string, value: string]>) {
  await open(page);
  await page.getByRole("button", { name: "Nuevo canal" }).first().click();
  await page
    .getByRole("dialog", { name: "Nuevo canal" })
    .getByRole("button", { name: new RegExp(`^${kind}`) })
    .click();
  const dialog = page.getByRole("dialog", { name: `Nuevo canal de ${kind}` });
  for (const [label, value] of tokens) await dialog.getByRole("textbox", { name: label, exact: true }).fill(value);
  await dialog.getByRole("button", { name: "Conectar", exact: true }).click();
  await expect(page.getByText("@apx", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(`Este es mi ${kind}`)).toBeVisible();
}

/** Keeps the new account the dialog connected, and opens its chats. */
async function create(page: Page) {
  const done = page.getByRole("button", { name: "Crear canal" });
  await expect(done).toBeEnabled();
  await done.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  await create(page);
});

test("Discord rooms: the owner lists a server room, and the bot answers there when called by name", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: ACCOUNT_NAME.discord, exact: true }).first().click();
  await page.getByRole("button", { name: "Editar cuenta" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Salas/ })
    .click();
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
  await page.getByRole("dialog").getByRole("button", { name: "Comportamiento" }).click();
  await expect(page.getByRole("radio", { name: "Solo vos" })).toBeChecked();
  await page.getByRole("radio", { name: "Todos" }).click();
  // Rooms and settings go out together with Save.
  await page.getByRole("button", { name: "Guardar y cerrar" }).click();
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
  await page.getByRole("button", { name: /#general/ }).click();
  await expect(page.getByText("roby what is Acme Notes?")).toBeVisible();
  await expect(page.getByText("nice weather today")).toBeVisible();

  // From the app the owner tells the agent what to post there: the answer goes to the room, not back to the app.
  const ask = page.getByRole("textbox", { name: /^Decile a .+ qué publicar en #general…$/ });
  await expect(page.getByRole("radio", { name: /publica$/ })).toBeChecked();
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

test("a second Discord bot is an account of its own: its own row, its own settings and a name the owner gives it", async ({
  page,
}) => {
  const { discord } = await world.info();
  await open(page);
  await page.getByRole("button", { name: "Nuevo canal" }).first().click();
  await page
    .getByRole("dialog", { name: "Nuevo canal" })
    .getByRole("button", { name: /^Discord/ })
    .click();
  await page.getByRole("textbox", { name: "Token del bot", exact: true }).fill(discord);
  // Connecting already keeps the account: it is removed whatever fails below, so later specs see only the first one.
  try {
    await page.getByRole("button", { name: "Conectar", exact: true }).click();
    const second = await until(async () =>
      (await rpc<{ channels: Array<{ id: string; type: string; label: string }> }>("channels.list")).channels.find(
        (c) => c.type === "discord" && c.id !== "discord",
      ),
    );
    expect(second.label).toBe("Discord 2");
    const name = page.getByRole("textbox", { name: "Nombre", exact: true });
    await expect(name).toHaveValue("Discord 2");
    await name.fill("Acme support");
    await create(page);
    await until(async () =>
      (await rpc<{ channels: Array<{ id: string; label: string }> }>("channels.list")).channels.some(
        (c) => c.id === second.id && c.label === "Acme support",
      ),
    );
    // The first account is untouched, and each row of the sidebar opens the settings of its own account.
    await expect(page.getByRole("button", { name: "Acme support", exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: ACCOUNT_NAME.discord, exact: true }).first().click();
    await page.getByRole("button", { name: "Editar cuenta" }).click();
    await expect(page.getByRole("textbox", { name: "Nombre", exact: true })).toHaveValue("Discord");
  } finally {
    const { channels } = await rpc<{ channels: Array<{ id: string; type: string }> }>("channels.list");
    for (const c of channels)
      if (c.type === "discord" && c.id !== "discord") await rpc("channels.set", { id: c.id, channel: null });
  }
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
  await create(page);
});

test("iMessage is a pair of tools on a Mac; elsewhere (this sandbox) the panel says so", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Nuevo canal" }).first().click();
  await page
    .getByRole("dialog", { name: "Nuevo canal" })
    .getByRole("button", { name: /^iMessage/ })
    .click();
  await expect(page.getByText("Solo en una Mac")).toBeVisible();
});

test("new channels are offered; Google Chat takes its subscription and whole JSON key", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Nuevo canal" }).first().click();
  const pick = page.getByRole("dialog", { name: "Nuevo canal" });
  for (const name of ["Google Chat", "SMS", "ntfy", "Nextcloud Talk", "IRC", "Twitch", "Microsoft Teams", "LINE"])
    await expect(pick.getByRole("button", { name: new RegExp(`^${name}`) })).toBeEnabled();
  await pick.getByRole("button", { name: /^Google Chat/ }).click();
  const connect = page.getByRole("button", { name: "Conectar", exact: true });
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
  await page.getByRole("button", { name: "Nuevo canal" }).first().click();
  await page
    .getByRole("dialog", { name: "Nuevo canal" })
    .getByRole("button", { name: /^Microsoft Teams/ })
    .click();
  await expect(page.getByText("Dirección pública", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Propia", exact: true }).click();
  await page.getByRole("textbox", { name: "Tu dirección", exact: true }).fill("https://hooks.example.com");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  // Before the account is made it shows the base address; its own (/hooks/<id>) once it is connected.
  await expect(page.getByText("https://hooks.example.com", { exact: true })).toBeVisible();
  await rpc("webhooks.set", { mode: "off" });
});
