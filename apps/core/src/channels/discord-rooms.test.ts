import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { OWNER_ID } from "../domain/persons.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { discordAdapter } from "./discord.ts";
import { fakeDiscord } from "./fake-discord.test-support.ts";
import { calledByName, roomDecision } from "./rooms.ts";

const TOKEN = "MTIzNDU2.fake.discord-token";
const OWNER = { id: "111", name: "Owner" };
const ANA = { id: "222", name: "Ana" };
const BEN = { id: "333", name: "Ben" };
const ROOMS = { general: "8001", help: "8002", logs: "8003", ideas: "8004" };

const llm = scriptedLlm((_req, { system, said }) => {
  // The useful rooms' judge: only a real question is worth an answer.
  if (system.startsWith("You decide whether an assistant bot"))
    return say(said.includes("how do I install") ? '{"reply": true, "reason": "a question"}' : '{"reply": false}');
  return say(
    `Room answer to: ${
      said
        .split("\n")
        .filter((l) => !l.startsWith("<") && l.trim())
        .at(-2) ?? ""
    }`,
  );
});

let env: Awaited<ReturnType<typeof startCore>>;
let dc: Awaited<ReturnType<typeof fakeDiscord>>;

const until = async (check: () => boolean | Promise<boolean>, what: string, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
};
const posts = (room: string) => dc.messagesTo(room).map((m) => m.body);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const roomThread = (room: string) => env.core.store.threads.byConversation("dc", room);
const kept = (room: string) => {
  const t = roomThread(room);
  return t
    ? env.core.store.messages.list(t.id).map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""))
    : [];
};

before(async () => {
  dc = await fakeDiscord(TOKEN);
  env = await startCore({
    llm,
    aux: true,
    roomBurstMs: 60,
    channelAdapters: { discord: (c, t) => discordAdapter(c, t, dc.urls) },
  });
  env.core.store.persons.owner();
  env.core.store.persons.link(OWNER_ID, { channel: "dc", external_id: OWNER.id, label: "Discord" });
  await env.client.call("channels.set", {
    id: "dc",
    channel: {
      type: "discord",
      agent_id: "roby",
      rooms: {
        rooms: [
          { id: ROOMS.general, name: "general", mode: "mention" },
          { id: ROOMS.help, name: "help", mode: "always" },
          { id: ROOMS.logs, name: "logs", mode: "read" },
          { id: ROOMS.ideas, name: "ideas", mode: "useful" },
        ],
        names: ["roby"],
        knowledge: "Acme Notes is a note app; install it with brew install acme-notes.",
        rules: "Never talk about prices.",
        limits: { user_cooldown_s: 1, room_replies_per_hour: 30, checks_per_hour: 120 },
      },
    },
    token: TOKEN,
  });
  await until(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
});
after(async () => {
  await env.core.close();
  await dc.close();
  env.cleanup();
});

test("with rooms the bot also reads servers; an unlisted room does not exist for it", async () => {
  // "running" can come a moment before the gateway's identify frame reaches the fake server.
  await until(() => dc.identified.length > 0, "identified");
  assert.equal(dc.identified.at(-1)?.intents, (1 << 12) | (1 << 15) | (1 << 9));
  dc.message(ANA, "roby are you there?", { room: "9999" });
  await pause(200);
  assert.equal(posts("9999").length, 0);
  assert.equal(roomThread("9999"), undefined, "nothing kept either");
});

test("a mention room keeps everything and answers only when called: by name, @mention or a reply to it", async () => {
  dc.message(ANA, "anyone tried the beta?", { room: ROOMS.general });
  await until(() => kept(ROOMS.general).length === 1, "kept");
  await pause(150);
  assert.equal(posts(ROOMS.general).length, 0, "not called, not answered");
  assert.equal(roomThread(ROOMS.general)?.title, "#general");

  const asked = dc.message(BEN, "Roby, what is Acme Notes?", { room: ROOMS.general });
  await until(() => posts(ROOMS.general).length === 1, "answered by name");
  const reply = posts(ROOMS.general)[0];
  assert.deepEqual(reply?.message_reference, { message_id: asked, fail_if_not_exists: false }, "as a reply");
  assert.deepEqual(reply?.allowed_mentions, { parse: [] });

  dc.message(ANA, "and on Linux?", { room: ROOMS.general, mention: true });
  await until(() => posts(ROOMS.general).length === 2, "answered by @mention");
  assert.ok(kept(ROOMS.general).includes("and on Linux?"), "the bot's own @mention is dropped from the text");
  await pause(1100); // Ben's pause between answers
  dc.message(BEN, "thanks!", { room: ROOMS.general, replyToBot: true });
  await until(() => posts(ROOMS.general).length === 3, "answered as a reply to it");
});

test("a room's turn is sealed and public: the owner's notes, the rules last, the room's talk as data, no tools", async () => {
  const call = llm.calls.findLast((c) => String(c.messages[0]?.content).includes("#general"));
  assert.ok(call);
  const system = String(call.messages[0]?.content);
  assert.match(system, /public room of a Discord server/);
  assert.match(system, /brew install acme-notes/);
  assert.ok(system.trimEnd().endsWith("Never talk about prices."), "the rules go last");
  assert.equal(call.tools?.length ?? 0, 0, "no tools in a room");
  const input = String(call.messages.at(-1)?.content);
  assert.match(input, /<room_messages[^>]*>[\s\S]*@ana: anyone tried the beta\?/);
  assert.match(input, /<room_message from="@(ana|ben)"/);
  assert.equal(
    call.messages.filter((m) => m.role === "assistant").length,
    0,
    "the room's talk is its context, not a history of turns",
  );
});

test("read rooms never answer; always rooms answer everyone, within a pause per person", async () => {
  dc.message(ANA, "roby deploy failed again", { room: ROOMS.logs });
  await until(() => kept(ROOMS.logs).length === 1, "kept in a read room");
  await pause(150);
  assert.equal(posts(ROOMS.logs).length, 0);

  dc.message(ANA, "how does sync work?", { room: ROOMS.help });
  await until(() => posts(ROOMS.help).length === 1, "always answers");
  dc.message(ANA, "and offline?", { room: ROOMS.help });
  await pause(250);
  assert.equal(posts(ROOMS.help).length, 1, "the same person within the pause is kept, not answered");
  await pause(900);
  dc.message(ANA, "and on the phone?", { room: ROOMS.help });
  await until(() => posts(ROOMS.help).length === 2, "after the pause it answers again");
});

test("one person's quick messages get one answer, to the last of them", async () => {
  const before_ = posts(ROOMS.help).length;
  await pause(1100);
  dc.message(BEN, "hi", { room: ROOMS.help });
  dc.message(BEN, "I have a question", { room: ROOMS.help });
  const last = dc.message(BEN, "can I export to PDF?", { room: ROOMS.help });
  await until(() => posts(ROOMS.help).length === before_ + 1, "one answer");
  await pause(200);
  assert.equal(posts(ROOMS.help).length, before_ + 1);
  assert.deepEqual(posts(ROOMS.help).at(-1)?.message_reference, { message_id: last, fail_if_not_exists: false });
  assert.ok(
    ["hi", "I have a question"].every((t) => kept(ROOMS.help).includes(t)),
    "the earlier ones are kept",
  );
});

test("a useful room asks the cheap model about uncalled messages and speaks only on its yes", async () => {
  dc.message(ANA, "lol nice", { room: ROOMS.ideas });
  await until(() => kept(ROOMS.ideas).length === 1, "kept");
  await pause(150);
  assert.equal(posts(ROOMS.ideas).length, 0, "the judge said no");
  dc.message(BEN, "how do I install it on a Mac?", { room: ROOMS.ideas });
  await until(() => posts(ROOMS.ideas).length === 1, "the judge said yes");
});

test("owner only: in rooms only the owner gets answers", async () => {
  const set = async (owner_only: boolean) => {
    const cur = (await env.client.call("channels.list", {})).channels[0];
    await env.client.call("channels.set", {
      id: "dc",
      channel: { type: "discord", agent_id: "roby", rooms: { ...(cur?.rooms ?? { rooms: [] }), owner_only } },
    });
    await until(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "up");
  };
  await set(true);
  await pause(1100);
  const n = posts(ROOMS.help).length;
  dc.message(BEN, "are you there?", { room: ROOMS.help });
  await pause(250);
  assert.equal(posts(ROOMS.help).length, n);
  dc.message(OWNER, "roby, status?", { room: ROOMS.help });
  await until(() => posts(ROOMS.help).length === n + 1, "the owner is answered");
  const call = llm.calls.at(-1);
  assert.match(String(call?.messages.at(-1)?.content), /<room_message from="[^"]*" owner="yes"/);
  assert.equal(call?.tools?.length ?? 0, 0, "the owner too gets a sealed turn in a public room");
  await set(false);
});

test("names are whole words in any script; the decision follows the room's mode", () => {
  assert.equal(calledByName("hola Roby!", ["roby"]), true);
  assert.equal(calledByName("robyn is here", ["roby"]), false);
  assert.equal(calledByName("ñroby", ["roby"]), false);
  assert.equal(calledByName("ok roby-superagent", ["roby-superagent"]), true);
  const d = (mode: "always" | "mention" | "useful" | "read", called = false, owner = false, ownerOnly = false) =>
    roomDecision({ mode, called, owner, ownerOnly });
  assert.equal(d("read", true, true), "keep");
  assert.equal(d("mention"), "keep");
  assert.equal(d("mention", true), "reply");
  assert.equal(d("useful"), "gate");
  assert.equal(d("always"), "reply");
  assert.equal(d("always", true, false, true), "keep");
});
