import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { OWNER_ID } from "../domain/persons.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { callsBot, telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-rooms-token";
const BOT = { id: 1, username: "apx_test_bot" };
const OWNER = { id: 1001, name: "Owner", username: "owner_acme" };
const ANA = { id: 2002, name: "Ana", username: "ana_acme" };
const GROUPS = { team: -1001234500001, all: -1001234500002, unlisted: -1001234500009 };

// Answers the room's last message (the turn also carries the earlier ones) and quotes it, so a test finds its answer
// by what it says.
const llm = scriptedLlm((req, { said }) => {
  const room = [
    ...String(req.messages.at(-1)?.content).matchAll(/<room_message(?:\s[^>]*)?>([\s\S]*?)<\/room_message>/g),
  ];
  const last = (room.at(-1)?.[1] ?? said).trim();
  if (last.includes("ping ana")) return say("Sure @ana_acme, and @ben_acme too");
  return say(`Group answer to: ${last.slice(-60)}`);
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const posts = (chat: number) => tg.messagesTo(chat).map((m) => m.body);
/** The bot's post answering `text` in `chat` (the fake model quotes what it answers). */
const answerTo = (chat: number, text: string) => posts(chat).find((p) => String(p.text).includes(text));
const roomThread = (chat: number) => env.core.store.threads.byConversation("tg", String(chat));
const kept = (chat: number) => {
  const t = roomThread(chat);
  return t
    ? env.core.store.messages.list(t.id).map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""))
    : [];
};
const mention = (text: string, handle = `@${BOT.username}`) => ({
  entities: [{ type: "mention", offset: text.indexOf(handle), length: handle.length }],
});

async function setRooms(owner_only = false) {
  await env.client.call("channels.set", {
    id: "tg",
    channel: {
      type: "telegram",
      agent_id: "roby",
      rooms: {
        rooms: [
          { id: String(GROUPS.team), name: "Acme team", mode: "mention" },
          { id: String(GROUPS.all), name: "Acme everyone", mode: "always" },
        ],
        names: [],
        owner_only,
        knowledge: "Acme Notes is a note app.",
        rules: "",
        reply_when: "",
        limits: { user_cooldown_s: 0, room_replies_per_hour: 30, checks_per_hour: 120 },
      },
    },
  });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
}

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({
    llm,
    roomBurstMs: 40,
    channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) },
  });
  env.core.store.persons.owner();
  env.core.store.persons.link(OWNER_ID, { channel: "tg", external_id: String(OWNER.id), label: "Telegram" });
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  await setRooms();
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

test("a group message calls the bot by @mention, a command to it, or a reply to its message", () => {
  const text = "hey @apx_test_bot";
  assert.equal(callsBot({ message_id: 1, chat: { id: -1, type: "group" }, text, ...mention(text) }, BOT), true);
  const other = "hey @someone_else";
  assert.equal(
    callsBot({ message_id: 1, chat: { id: -1, type: "group" }, text: other, ...mention(other, "@someone_else") }, BOT),
    false,
  );
  const cmd = "/help@apx_test_bot";
  const entities = [{ type: "bot_command", offset: 0, length: cmd.length }];
  assert.equal(callsBot({ message_id: 1, chat: { id: -1, type: "group" }, text: cmd, entities }, BOT), true);
  const reply = { message_id: 1, chat: { id: -1, type: "group" }, text: "ok", reply_to_message: { from: BOT } };
  assert.equal(callsBot(reply, BOT), true);
});

test("an unlisted group is neither kept nor answered, but it is offered in the rooms picker", async () => {
  tg.message(ANA, "hello @apx_test_bot", { id: GROUPS.unlisted, type: "supergroup", title: "Northwind" });
  await waitFor(async () => {
    const { rooms } = await env.client.call("channels.rooms", { channel: "tg" });
    return rooms.some((r) => r.id === String(GROUPS.unlisted) && r.name === "Northwind");
  }, "offered");
  await pause(150);
  assert.equal(posts(GROUPS.unlisted).length, 0);
  assert.equal(roomThread(GROUPS.unlisted), undefined, "nothing kept either");
});

test("the bot added to a group offers it; removed, it is offered no more", async () => {
  const offered = async (id: number) =>
    (await env.client.call("channels.rooms", { channel: "tg" })).rooms.some((r) => r.id === String(id));
  tg.membership({ id: -1001234500077, title: "Globex" }, "member");
  await waitFor(() => offered(-1001234500077), "offered on join");
  tg.membership({ id: -1001234500077, title: "Globex" }, "kicked");
  await waitFor(async () => !(await offered(-1001234500077)), "dropped on removal");
});

test("a mention group keeps every message and answers only when called, in the group, as a reply", async () => {
  const chat = { id: GROUPS.team, type: "supergroup", title: "Acme team" };
  tg.message(ANA, "anyone tried the beta?", chat);
  await waitFor(() => kept(GROUPS.team).length === 1, "kept");
  await pause(150);
  assert.equal(posts(GROUPS.team).length, 0, "not called, not answered");

  const text = "@apx_test_bot what is Acme Notes?";
  const asked = tg.message(ANA, text, chat, mention(text));
  await waitFor(() => posts(GROUPS.team).length === 1, "answered when @mentioned");
  assert.ok(kept(GROUPS.team).includes("what is Acme Notes?"), "the bot's own @mention is dropped from the text");
  assert.deepEqual(posts(GROUPS.team)[0]?.reply_parameters, { message_id: asked, allow_sending_without_reply: true });
  assert.equal(tg.messagesTo(ANA.id).length, 0, "the answer goes to the group, not to the person");

  tg.message(ANA, "thanks!", chat, { reply_to_message: { from: { id: BOT.id, first_name: "bot" } } });
  await waitFor(() => posts(GROUPS.team).length === 2, "answered as a reply to it");
});

test("a group's turn is sealed: no tools, a Telegram group, the owner's notes", async () => {
  const call = llm.calls.findLast((c) => String(c.messages[0]?.content).includes("#Acme team"));
  assert.ok(call);
  const system = String(call.messages[0]?.content);
  assert.match(system, /a Telegram group/);
  assert.match(system, /Acme Notes is a note app/);
  assert.equal(call.tools?.length ?? 0, 0, "no tools in a group");
});

test("an always group answers every message without a mention", async () => {
  tg.message(ANA, "how does sync work?", { id: GROUPS.all, type: "group", title: "Acme everyone" });
  await waitFor(() => answerTo(GROUPS.all, "how does sync work?"), "answered without a mention");
});

test("only the people the owner's turn names are pinged; any other @handle pings nobody", async () => {
  tg.message(OWNER, "ping ana", { id: GROUPS.all, type: "group", title: "Acme everyone" });
  // Found by what it says, not by count: an earlier test's late answer must not stand in for this one.
  const text = await waitFor(
    () =>
      posts(GROUPS.all)
        .map((p) => String(p.text))
        .find((t) => t.startsWith("Sure ")),
    "answered",
  );
  assert.match(text, /Sure @ana_acme,/, "a person of the group, named by the owner's turn, is pinged");
  assert.match(text, /@​ben_acme/, "a handle nobody in the group has pings nobody");
});

test("owner only: in groups only the owner gets answers", async () => {
  await setRooms(true);
  const chat = { id: GROUPS.all, type: "group", title: "Acme everyone" };
  tg.message(ANA, "and offline?", chat);
  await waitFor(() => kept(GROUPS.all).includes("and offline?"), "kept");
  tg.message(OWNER, "status of the beta?", chat);
  await waitFor(() => answerTo(GROUPS.all, "status of the beta?"), "the owner is answered");
  // Checked after a later message was answered, so an answer to Ana had as long to come.
  assert.equal(answerTo(GROUPS.all, "and offline?"), undefined, "someone else is read, not answered");
  await setRooms(false);
});

test("private chats are unchanged: the owner's direct message reaches the owner's chat", async () => {
  tg.message(OWNER, "hello in private");
  await waitFor(() => tg.messagesTo(OWNER.id).some((m) => /hello in private/.test(String(m.body.text))), "answered");
});
