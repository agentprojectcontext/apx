import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-room-agent";
const ANA = { id: 2002, name: "Ana" };
const GROUP = -1001234;
const ROOM = { id: String(GROUP), name: "Acme", mode: "always" } as const;

async function setup(t: TestContext) {
  const tg = await fakeTelegram(TOKEN);
  const llm = scriptedLlm(() => say("Noted"));
  const env = await startCore({ llm, channelAdapters: { telegram: (c, token) => telegramAdapter(c, token, tg.url) } });
  t.after(async () => {
    await env.core.close();
    await tg.close();
    await env.cleanup();
  });
  const helper = await env.client.call("agents.create", { slug: "northwind-helper", name: "Helper", role: "helper" });
  const desk = await env.client.call("agents.create", { slug: "northwind-desk", name: "Desk", role: "desk" });
  return { ...env, tg, llm, helper: helper.id, desk: desk.id };
}

const rooms = (room: { id: string; name: string; mode: "always"; agent_id?: string }) => ({
  rooms: [room],
  names: [],
  owner_only: false,
  knowledge: "",
  rules: "",
  reply_when: "",
  limits: { user_cooldown_s: 0, room_replies_per_hour: 30, checks_per_hour: 120 },
});

test("a room with an agent of its own is answered by it, and keeps it when the account's contacts agent changes", async (t) => {
  const env = await setup(t);
  const tg = { type: "telegram", agent_id: "superagent", owner_thread: "own" } as const;
  await env.client.call("channels.set", {
    id: "tg",
    channel: { ...tg, rooms: rooms({ ...ROOM, agent_id: env.helper }) },
    token: TOKEN,
  });
  env.tg.message(ANA, "hello room", { id: GROUP, type: "supergroup", title: "Acme" });
  await waitFor(() => env.core.store.threads.byConversation("tg", ROOM.id), "the room's chat", { ms: 8000 });
  assert.equal(env.core.store.threads.byConversation("tg", ROOM.id)?.agent_ids[0], env.helper, "made with its agent");

  await env.client.call("channels.set", {
    id: "tg",
    channel: { ...tg, contacts_agent_id: env.desk, rooms: rooms({ ...ROOM, agent_id: env.helper }) },
    token: TOKEN,
  });
  assert.equal(
    env.core.store.threads.byConversation("tg", ROOM.id)?.agent_ids[0],
    env.helper,
    "the account moves it not",
  );

  await env.client.call("channels.set", {
    id: "tg",
    channel: { ...tg, contacts_agent_id: env.desk, rooms: rooms(ROOM) },
    token: TOKEN,
  });
  assert.equal(
    env.core.store.threads.byConversation("tg", ROOM.id)?.agent_ids[0],
    env.desk,
    "without one, the account's",
  );
});

test("giving a room an agent hands its chat to it", async (t) => {
  const env = await setup(t);
  const tg = { type: "telegram", agent_id: "superagent", owner_thread: "own", rooms: rooms(ROOM) } as const;
  await env.client.call("channels.set", { id: "tg", channel: tg, token: TOKEN });
  env.tg.message(ANA, "hello room", { id: GROUP, type: "supergroup", title: "Acme" });
  await waitFor(() => env.core.store.threads.byConversation("tg", ROOM.id), "the room's chat", { ms: 8000 });
  assert.equal(env.core.store.threads.byConversation("tg", ROOM.id)?.agent_ids[0], "superagent");

  await env.client.call("channels.set", {
    id: "tg",
    channel: { ...tg, rooms: rooms({ ...ROOM, agent_id: env.helper }) },
    token: TOKEN,
  });
  assert.equal(env.core.store.threads.byConversation("tg", ROOM.id)?.agent_ids[0], env.helper);
});

test("a room agent that does not exist is refused", async (t) => {
  const env = await setup(t);
  await assert.rejects(
    env.client.call("channels.set", {
      id: "tg",
      channel: { type: "telegram", agent_id: "superagent", rooms: rooms({ ...ROOM, agent_id: "nobody" }) },
      token: TOKEN,
    }),
    /agent nobody/,
  );
});
