// The Discord transport against a local stand-in for the Gateway: the
// handshake, the message shape the dispatcher gets, the close codes that must
// not be retried, and what a post actually sends to the REST API.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-discord-gw-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { WebSocketServer } = await import("ws");
const { createDiscordGateway, normalizeDiscordMessage, DISCORD_INTENTS, avatarProblem } = await import("#core/channels/discord/gateway.js");

const BOT = "1000000000000000001";
const GUILD = "4000000000000000001";
const ROOM = "2000000000000000001";
const THREAD = "2000000000000000010";

async function fakeGateway(script) {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const received = [];
  wss.on("connection", (sock) => {
    const say = (p) => sock.send(JSON.stringify(p));
    sock.on("message", (raw) => {
      const p = JSON.parse(String(raw));
      received.push(p);
      script.onClient?.(p, say, sock);
    });
    script.onOpen?.(say, sock);
  });
  return { url: `ws://127.0.0.1:${wss.address().port}`, received, close: () => new Promise((r) => wss.close(r)) };
}

const until = async (pred, ms = 2_000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("normalize: thread parent, display name and reply target come through", () => {
  const channels = new Map([[THREAD, { name: "una-duda", parent_id: ROOM }]]);
  const m = normalizeDiscordMessage({
    id: "3000000000000000001", channel_id: THREAD, guild_id: GUILD,
    author: { id: "1000000000000000003", username: "alice_x", global_name: "Alice" },
    member: { nick: "Ali" },
    content: "hola", mentions: [{ id: BOT }],
    referenced_message: { id: "3000000000000000000", author: { id: BOT, username: "roby" }, content: "antes" },
    timestamp: "2026-09-28T21:00:00.000+00:00",
  }, channels);
  assert.equal(m.parent_id, ROOM);
  assert.equal(m.channel_name, "una-duda");
  assert.equal(m.author.name, "Ali", "the server nickname wins");
  assert.deepEqual(m.mentions, [BOT]);
  assert.equal(m.reply_to.author_id, BOT);
  assert.equal(m.ts, "2026-09-28T21:00:00.000Z");
});

test("gateway: hello → identify with the intents → READY → messages from guilds only", async () => {
  const gw = await fakeGateway({
    onOpen: (say) => say({ op: 10, d: { heartbeat_interval: 60_000 } }),
    onClient: (p, say) => {
      if (p.op !== 2) return;
      say({ op: 0, s: 1, t: "READY", d: { session_id: "s1", user: { id: BOT, username: "roby" } } });
      say({ op: 0, s: 2, t: "GUILD_CREATE", d: { id: GUILD, channels: [{ id: ROOM, name: "general", type: 0 }], threads: [] } });
      say({ op: 0, s: 3, t: "MESSAGE_CREATE", d: { id: "3000000000000000005", channel_id: ROOM, guild_id: GUILD, author: { id: "1000000000000000003", username: "alice" }, content: "hola roby", mentions: [] } });
      say({ op: 0, s: 4, t: "MESSAGE_CREATE", d: { id: "3000000000000000006", channel_id: "9000000000000000001", author: { id: "1000000000000000003", username: "alice" }, content: "un DM", mentions: [] } });
    },
  });
  const got = [];
  const g = createDiscordGateway({ token: "t", gatewayUrl: gw.url, onMessage: (m) => got.push(m) });
  g.start();
  try {
    await until(() => got.length >= 1 && g.botId());
    await new Promise((r) => setTimeout(r, 50));
    const identify = gw.received.find((p) => p.op === 2);
    assert.equal(identify.d.intents, DISCORD_INTENTS);
    assert.ok(DISCORD_INTENTS & (1 << 15), "Message Content is requested");
    assert.equal(g.botId(), BOT);
    assert.equal(got.length, 1, "the DM is not a room");
    assert.equal(got[0].channel_name, "general");
    assert.equal(g.status().state, "connected");
  } finally {
    g.stop();
    await gw.close();
  }
});

test("gateway: a missing Message Content intent (4014) is reported and not retried", async () => {
  let connections = 0;
  const gw = await fakeGateway({
    onOpen: (_say, sock) => {
      connections += 1;
      sock.close(4014, "Disallowed intent(s).");
    },
  });
  const g = createDiscordGateway({ token: "t", gatewayUrl: gw.url });
  g.start();
  try {
    await until(() => g.status().state === "error");
    await new Promise((r) => setTimeout(r, 1_300));
    assert.equal(connections, 1, "no retry loop against a config error");
    assert.match(g.status().error, /Message Content Intent/);
  } finally {
    g.stop();
    await gw.close();
  }
});

test("rest: a post never pings anyone but the person replied to", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ id: "5000000000000000001" }) };
  };
  const g = createDiscordGateway({ token: "secret-token", fetchImpl, apiBase: "http://discord.invalid/api" });
  const r = await g.send(ROOM, "hola @everyone", { replyTo: "3000000000000000005" });
  assert.equal(r.id, "5000000000000000001");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url, `http://discord.invalid/api/channels/${ROOM}/messages`);
  assert.equal(calls[0].init.headers.authorization, "Bot secret-token");
  assert.deepEqual(body.allowed_mentions, { parse: [], replied_user: true });
  assert.equal(body.message_reference.message_id, "3000000000000000005");
});

test("rest: one 429 is waited out and retried", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) return { ok: false, status: 429, json: async () => ({ retry_after: 0.01 }) };
    return { ok: true, status: 200, json: async () => ({ id: "5000000000000000002" }) };
  };
  const g = createDiscordGateway({ token: "t", fetchImpl, apiBase: "http://discord.invalid/api" });
  assert.equal((await g.send(ROOM, "x")).id, "5000000000000000002");
  assert.equal(n, 2);
});

test("gateway: an expired session (4009) is not resumed — the next connection identifies", async () => {
  let n = 0;
  const gw = await fakeGateway({
    onOpen: (say) => { n += 1; say({ op: 10, d: { heartbeat_interval: 60_000 } }); },
    onClient: (p, say, sock) => {
      if (p.op === 2 && n === 1) {
        say({ op: 0, s: 1, t: "READY", d: { session_id: "s1", resume_gateway_url: null, user: { id: BOT, username: "roby" } } });
        setTimeout(() => sock.close(4009, "Session timed out"), 20);
      }
    },
  });
  const g = createDiscordGateway({ token: "t", gatewayUrl: gw.url });
  g.start();
  try {
    await until(() => gw.received.filter((p) => p.op === 2 || p.op === 6).length >= 2, 4_000);
    const ops = gw.received.filter((p) => p.op === 2 || p.op === 6).map((p) => p.op);
    assert.deepEqual(ops, [2, 2], "identify, then identify again — never resume a dead session");
  } finally {
    g.stop();
    await gw.close();
  }
});

test("rooms: the server's text channels, under their category, voice and categories left out", async () => {
  const gw = await fakeGateway({
    onOpen: (say) => say({ op: 10, d: { heartbeat_interval: 60_000 } }),
    onClient: (p, say) => {
      if (p.op !== 2) return;
      say({ op: 0, s: 1, t: "READY", d: { session_id: "s1", user: { id: BOT, username: "roby" } } });
      say({ op: 0, s: 2, t: "GUILD_CREATE", d: {
        id: GUILD, name: "Acme Community",
        channels: [
          { id: "2000000000000000100", name: "Comunidad", type: 4, position: 1 },
          { id: "2000000000000000101", name: "Texto", type: 4, position: 0 },
          { id: "2000000000000000002", name: "feedback", type: 15, parent_id: "2000000000000000100", position: 0 },
          { id: ROOM, name: "general", type: 0, parent_id: "2000000000000000101", position: 0 },
          { id: "2000000000000000003", name: "General", type: 2, parent_id: "2000000000000000101", position: 1 },
        ],
        threads: [{ id: THREAD, name: "una-duda", type: 11, parent_id: ROOM }],
      } });
    },
  });
  const g = createDiscordGateway({ token: "t", gatewayUrl: gw.url });
  g.start();
  try {
    await until(() => g.rooms().length === 2);
    assert.deepEqual(g.rooms().map((r) => [r.name, r.category, r.guild]), [
      ["general", "Texto", "Acme Community"],
      ["feedback", "Comunidad", "Acme Community"],
    ]);
    assert.equal(g.status().guilds, 1);
  } finally {
    g.stop();
    await gw.close();
  }
});

test("avatar: only images, under the cap, sent as PATCH /users/@me", async () => {
  const png = "data:image/png;base64," + Buffer.from("fake-png").toString("base64");
  assert.equal(avatarProblem(png), null);
  assert.match(avatarProblem("https://example.com/a.png"), /data: URL/);
  assert.match(avatarProblem("data:text/html;base64,PGgxPg=="), /PNG, JPEG/);
  assert.match(avatarProblem("data:image/png;base64," + "A".repeat(3_000_000)), /1\.5 MB/);

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ id: BOT, username: "roby", avatar: "abc123" }) };
  };
  const g = createDiscordGateway({ token: "t", fetchImpl, apiBase: "http://discord.invalid/api" });
  const bot = await g.setAvatar(png);
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].url, "http://discord.invalid/api/users/@me");
  assert.equal(JSON.parse(calls[0].init.body).avatar, png);
  assert.equal(bot.avatar_url, `https://cdn.discordapp.com/avatars/${BOT}/abc123.png?size=128`);
  await assert.rejects(g.setAvatar("data:text/plain;base64,aGk="), /PNG, JPEG/);
});

test("@Roby picked from autocomplete as the bot's ROLE is a call to the bot", () => {
  const ROLE = "3000000000000000900";
  const OTHER_ROLE = "3000000000000000901";
  const roles = new Map([[ROLE, { name: "Roby", bot_id: BOT }], [OTHER_ROLE, { name: "mods", bot_id: null }]]);
  const d = {
    id: "3000000000000000010", channel_id: ROOM, guild_id: GUILD,
    author: { id: "1000000000000000003", username: "alice" },
    content: `<@&${ROLE}> podés revisar?`, mentions: [], mention_roles: [ROLE],
  };
  const m = normalizeDiscordMessage(d, new Map(), { roles, botId: BOT });
  assert.deepEqual(m.mentions, [BOT], "mentioning the bot's managed role calls the bot");
  assert.equal(m.content, "@Roby podés revisar?");
  const other = normalizeDiscordMessage({ ...d, content: `<@&${OTHER_ROLE}> hola`, mention_roles: [OTHER_ROLE] }, new Map(), { roles, botId: BOT });
  assert.deepEqual(other.mentions, [], "any other role is not a call");
  assert.equal(other.content, "@mods hola");
});

test("gateway: learns the bot's managed role from GUILD_CREATE and GUILD_ROLE_CREATE", async () => {
  const ROLE = "3000000000000000900";
  const gw = await fakeGateway({
    onOpen: (say) => say({ op: 10, d: { heartbeat_interval: 60_000 } }),
    onClient: (p, say) => {
      if (p.op !== 2) return;
      say({ op: 0, s: 1, t: "READY", d: { session_id: "s1", user: { id: BOT, username: "roby" } } });
      say({ op: 0, s: 2, t: "GUILD_CREATE", d: { id: GUILD, name: "Acme", channels: [{ id: ROOM, name: "general", type: 0 }], threads: [], roles: [] } });
      say({ op: 0, s: 3, t: "GUILD_ROLE_CREATE", d: { guild_id: GUILD, role: { id: ROLE, name: "Roby", tags: { bot_id: BOT } } } });
      say({ op: 0, s: 4, t: "MESSAGE_CREATE", d: { id: "3000000000000000011", channel_id: ROOM, guild_id: GUILD, author: { id: "1000000000000000003", username: "alice" }, content: `<@&${ROLE}> hola`, mentions: [], mention_roles: [ROLE] } });
    },
  });
  const got = [];
  const g = createDiscordGateway({ token: "t", gatewayUrl: gw.url, onMessage: (m) => got.push(m) });
  g.start();
  try {
    await until(() => got.length === 1);
    assert.deepEqual(got[0].mentions, [BOT]);
    assert.equal(got[0].content, "@Roby hola");
  } finally {
    g.stop();
    await gw.close();
  }
});
