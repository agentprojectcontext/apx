import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { OWNER_ID } from "../domain/persons.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { canWrite, discordAdapter } from "./discord.ts";
import { fakeDiscord } from "./fake-discord.test-support.ts";
import { calledByName, roomDecision } from "./rooms.ts";

const TOKEN = "MTIzNDU2.fake.discord-token";
const OWNER = { id: "111", name: "Owner" };
const ANA = { id: "222", name: "Ana" };
const BEN = { id: "333", name: "Ben" };
const ROOMS = { general: "8001", help: "8002", logs: "8003", ideas: "8004" };

const llm = scriptedLlm((req, { system, said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 160)}`);
  if (said.includes("announce the beta"))
    return callTool("p5", "channel_post", { room: "#ideas", text: "The beta is coming" });
  if (said.includes("post the release note"))
    return callTool("p1", "channel_post", { room: "#logs", text: "v2.1 is out @everyone" });
  if (said.includes("which channels")) return callTool("l1", "channel_list", {});
  if (said.includes("thank ana for the issues")) return say("Thanks @Ana for the issues, and @nobody too!");
  if (said.includes("greet ana please")) return say("Hi @ana!");
  if (said.includes("post in a room that is not there"))
    return callTool("p2", "channel_post", { room: "nowhere", text: "hi" });
  if (said.includes("post in a near name")) return callTool("p3", "channel_post", { room: "log", text: "hi" });
  if (said.includes("message a room as a person"))
    return callTool("p4", "message_contact", { to: "#logs", text: "hi" });
  // The useful rooms' judge: only a real question is worth an answer.
  if (system.startsWith("You decide whether an assistant bot"))
    return {
      ...say(said.includes("how do I install") ? '{"reply": true, "reason": "a question"}' : '{"reply": false}'),
      usage: { input: 300, output: 8 },
    };
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
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
});
after(async () => {
  await env.core.close();
  await dc.close();
  await env.cleanup();
});

test("with rooms the bot also reads servers; an unlisted room does not exist for it", async () => {
  // "running" can come a moment before the gateway's identify frame reaches the fake server.
  await waitFor(() => dc.identified.length > 0, "identified");
  assert.equal(dc.identified.at(-1)?.intents, (1 << 12) | (1 << 15) | (1 << 9));
  dc.message(ANA, "roby are you there?", { room: "9999" });
  await pause(200);
  assert.equal(posts("9999").length, 0);
  assert.equal(roomThread("9999"), undefined, "nothing kept either");
});

test("a mention room keeps everything and answers only when called: by name, @mention or a reply to it", async () => {
  dc.message(ANA, "anyone tried the beta?", { room: ROOMS.general });
  await waitFor(() => kept(ROOMS.general).length === 1, "kept");
  await pause(150);
  assert.equal(posts(ROOMS.general).length, 0, "not called, not answered");
  assert.equal(roomThread(ROOMS.general)?.title, "#general");

  const asked = dc.message(BEN, "Roby, what is Acme Notes?", { room: ROOMS.general });
  await waitFor(() => posts(ROOMS.general).length === 1, "answered by name");
  const reply = posts(ROOMS.general)[0];
  assert.deepEqual(reply?.message_reference, { message_id: asked, fail_if_not_exists: false }, "as a reply");
  assert.deepEqual(reply?.allowed_mentions, { parse: [] });

  dc.message(ANA, "and on Linux?", { room: ROOMS.general, mention: true });
  await waitFor(() => posts(ROOMS.general).length === 2, "answered by @mention");
  assert.ok(kept(ROOMS.general).includes("and on Linux?"), "the bot's own @mention is dropped from the text");
  await pause(1100); // Ben's pause between answers
  dc.message(BEN, "thanks!", { room: ROOMS.general, replyToBot: true });
  await waitFor(() => posts(ROOMS.general).length === 3, "answered as a reply to it");
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
  await waitFor(() => kept(ROOMS.logs).length === 1, "kept in a read room");
  await pause(150);
  assert.equal(posts(ROOMS.logs).length, 0);

  dc.message(ANA, "how does sync work?", { room: ROOMS.help });
  await waitFor(() => posts(ROOMS.help).length === 1, "always answers");
  dc.message(ANA, "and offline?", { room: ROOMS.help });
  await pause(250);
  assert.equal(posts(ROOMS.help).length, 1, "the same person within the pause is kept, not answered");
  await pause(900);
  dc.message(ANA, "and on the phone?", { room: ROOMS.help });
  await waitFor(() => posts(ROOMS.help).length === 2, "after the pause it answers again");
});

test("one person's quick messages get one answer, to the last of them", async () => {
  const before_ = posts(ROOMS.help).length;
  await pause(1100);
  dc.message(BEN, "hi", { room: ROOMS.help });
  dc.message(BEN, "I have a question", { room: ROOMS.help });
  const last = dc.message(BEN, "can I export to PDF?", { room: ROOMS.help });
  await waitFor(() => posts(ROOMS.help).length === before_ + 1, "one answer");
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
  await waitFor(() => kept(ROOMS.ideas).length === 1, "kept");
  await pause(150);
  assert.equal(posts(ROOMS.ideas).length, 0, "the judge said no");
  dc.message(BEN, "how do I install it on a Mac?", { room: ROOMS.ideas });
  await waitFor(() => posts(ROOMS.ideas).length === 1, "the judge said yes");
  // Both questions to the cheap model are counted, as the room's filter.
  const { aux } = await env.client.call("usage.summary", {});
  const room = aux.find((a) => a.purpose === "room");
  assert.ok(room && room.calls >= 2 && room.input === room.calls * 300);
});

test("owner only: in rooms only the owner gets answers", async () => {
  const set = async (owner_only: boolean) => {
    const cur = (await env.client.call("channels.list", {})).channels[0];
    await env.client.call("channels.set", {
      id: "dc",
      channel: { type: "discord", agent_id: "roby", rooms: { ...(cur?.rooms ?? { rooms: [] }), owner_only } },
    });
    await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "up");
  };
  await set(true);
  await pause(1100);
  const n = posts(ROOMS.help).length;
  dc.message(BEN, "are you there?", { room: ROOMS.help });
  await pause(250);
  assert.equal(posts(ROOMS.help).length, n);
  dc.message(OWNER, "roby, status?", { room: ROOMS.help });
  await waitFor(() => posts(ROOMS.help).length === n + 1, "the owner is answered");
  const call = llm.calls.at(-1);
  assert.match(String(call?.messages.at(-1)?.content), /<room_message from="[^"]*" owner="yes"/);
  // The owner too gets a sealed turn in a public room: by default only the web, to look things up when they ask.
  assert.deepEqual(call?.tools?.map((t) => t.function.name).sort(), ["web_read", "web_search"]);
  assert.match(String(call?.messages[0]?.content), /This turn has only web search and reading/);
  await set(false);
});

test("research: none for members by default; off closes it to the owner too, everyone opens it to all", async () => {
  const research = async (level: "off" | "owner" | "everyone") => {
    const cur = (await env.client.call("channels.list", {})).channels[0];
    await env.client.call("channels.set", {
      id: "dc",
      channel: { type: "discord", agent_id: "roby", rooms: cur?.rooms ?? { rooms: [] }, research: level },
    });
    await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "up");
  };
  const toolsFor = async (who: { id: string; name: string }, text: string) => {
    await pause(1100);
    const n = posts(ROOMS.help).length;
    dc.message(who, text, { room: ROOMS.help });
    await waitFor(() => posts(ROOMS.help).length === n + 1, `answered: ${text}`);
    const call = llm.calls.findLast((c) => String(c.messages.at(-1)?.content).includes(text));
    return (call?.tools ?? []).map((t) => t.function.name).sort();
  };
  assert.deepEqual(await toolsFor(BEN, "roby find the docs for me"), [], "a member gets no tools by default");
  await research("off");
  assert.deepEqual(await toolsFor(OWNER, "roby search the changelog"), []);
  await research("everyone");
  assert.deepEqual(await toolsFor(BEN, "roby read the install page"), ["web_read", "web_search"]);
  await research("owner");
});

test("the owner's agent lists the channels with their rooms, and nothing secret", async () => {
  await env.client.call("threads.send", { thread: "home", text: "which channels can you reach?" });
  await env.settle("home");
  const listed = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(
    listed,
    /- Discord \(discord\): running; rooms: #general \(answers when called\), #help \(answers everyone\), #logs \(reads only\), #ideas \(answers when useful\)/,
  );
  assert.ok(!listed.includes(TOKEN.slice(-4)), "no token hint");
  const turn = llm.calls.find((c) => String(c.messages.at(-1)?.content).includes("which channels"));
  assert.ok(!String(turn?.messages.at(-1)?.content).includes("#general"), "the rooms are not pushed into the turn");
});

test("the owner's agent posts in a room when asked, even a read room, with no pings", async () => {
  await env.client.call("threads.send", { thread: "home", text: "post in a room that is not there" });
  await env.settle("home");
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /no room "nowhere"\. Rooms: #general \(Discord\)/);
  // A public post goes only to the exact room: a near name gets a suggestion, and a person's tool refuses a room.
  await env.client.call("threads.send", { thread: "home", text: "post in a near name" });
  await env.settle("home");
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /no room "log"; did you mean #logs \(Discord\)\?/);
  await env.client.call("threads.send", { thread: "home", text: "message a room as a person" });
  await env.settle("home");
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /#logs is a room, not a person; use channel_post/);
  assert.equal(posts(ROOMS.logs).length, 0);

  // Before anything from outside is in the chat: a room's talk in context makes the next send ask first.
  await env.client.call("threads.send", { thread: "home", text: "post the release note in logs" });
  await env.settle("home");
  await waitFor(() => posts(ROOMS.logs).length === 1, "posted in #logs");
  assert.equal(posts(ROOMS.logs)[0]?.content, "v2.1 is out @\u200beveryone");
  assert.ok(kept(ROOMS.logs).includes("v2.1 is out @\u200beveryone"), "kept in the room's chat");
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /sent to #logs on Discord/);

  // A room the bot may not write in: the agent hears Discord's refusal, not that it went.
  dc.failures.set(`POST /channels/${ROOMS.ideas}/messages`, [
    { status: 403, body: { message: "Missing Permissions" } },
  ]);
  await env.client.call("threads.send", { thread: "home", text: "announce the beta in ideas" });
  // The room's talk the last post returned is in context: this send asks first.
  const asked = async () => (await env.client.call("runs.pending", { thread: "home" })).inputs[0];
  await waitFor(async () => Boolean(await asked()), "asked");
  await env.client.call("runs.respond", { input: (await asked())?.id ?? "", decision: "approve" });
  await env.settle("home");
  assert.match(
    String(llm.calls.at(-1)?.messages.at(-1)?.content),
    /NOT sent to #ideas: Discord refused it \(Discord said: Missing Permissions\)/,
  );
});

test("from the app the owner tells the agent what to post in a room: it goes out there, pinging only who it names", async () => {
  // Someone else's @mention reads as their @username, and makes them someone the room's answers can mention.
  dc.message(OWNER, "<@222> could you look at the issues?", { room: ROOMS.logs, mentions: [ANA] });
  await waitFor(() => kept(ROOMS.logs).includes("@ana could you look at the issues?"), "kept with the username");
  const room = roomThread(ROOMS.logs);
  assert.ok(room);
  const n = posts(ROOMS.logs).length;
  await env.client.call("threads.send", { thread: room.id, text: "thank ana for the issues" });
  await env.settle(room.id);
  await waitFor(() => posts(ROOMS.logs).length === n + 1, "posted in the room, not answered in the app");
  const post = posts(ROOMS.logs).at(-1);
  assert.equal(post?.content, "Thanks <@222> for the issues, and @nobody too!");
  assert.deepEqual(post?.allowed_mentions, { parse: [], users: ["222"] });
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(
    input,
    /<owner_instruction>\nthank ana for the issues\n<\/owner_instruction>\nYour owner wrote this in the APX app/,
  );
  assert.equal(input.match(/<owner_instruction>/g)?.length, 1, "framed once");

  // "I'll write": the owner's words go out as they are, through the bot, with the same mentions.
  await env.client.call("channels.send", { thread: room.id, text: "@ana see you at the release" });
  await waitFor(() => posts(ROOMS.logs).length === n + 2, "posted as is");
  assert.equal(posts(ROOMS.logs).at(-1)?.content, "<@222> see you at the release");

  // The next turn reads the room's talk (the owner's words said there included) apart from their words from the app.
  await env.client.call("threads.send", { thread: room.id, text: "thank ana for the issues once more" });
  await env.settle(room.id);
  const next = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  const talk = /<room_messages[^>]*>([\s\S]*?)<\/room_messages>/.exec(next)?.[1] ?? "";
  assert.match(talk, /your owner: @ana could you look at the issues\?/);
  assert.match(talk, /your owner: @ana see you at the release/);
  assert.doesNotMatch(talk, /thank ana for the issues/);
  assert.match(next, /earlier words to you from the APX app[^\n]*\n- thank ana for the issues\n/);
});

test("a member's turn in a room pings nobody, even someone who wrote there", async () => {
  await pause(1100);
  const n = posts(ROOMS.help).length;
  dc.message(ANA, "hello all", { room: ROOMS.help });
  await waitFor(() => posts(ROOMS.help).length === n + 1, "Ana answered");
  await pause(1100);
  dc.message(BEN, "roby greet ana please", { room: ROOMS.help });
  await waitFor(() => posts(ROOMS.help).length === n + 2, "Ben answered");
  assert.equal(posts(ROOMS.help).at(-1)?.content, "Hi @ana!");
  assert.deepEqual(posts(ROOMS.help).at(-1)?.allowed_mentions, { parse: [] });
});

test("the owner picks rooms from the bot's servers, each saying whether the bot may write there", async () => {
  const SEND = String(1 << 11);
  dc.guild.channels = [
    { id: ROOMS.general, name: "general", type: 0 },
    { id: "8100", name: "voice", type: 2 },
    { id: "8101", name: "anuncios", type: 5, permission_overwrites: [{ id: "7001", type: 0, allow: "0", deny: SEND }] },
  ];
  const { rooms } = await env.client.call("channels.rooms", { channel: "dc" });
  assert.deepEqual(rooms, [
    { id: ROOMS.general, name: "general", server: "Acme", writable: true },
    { id: "8101", name: "anuncios", server: "Acme", writable: false },
  ]);
});

test("writing in a room follows Discord: roles, then @everyone's, the roles' and the member's overwrites", () => {
  const VIEW = 1n << 10n;
  const SEND = 1n << 11n;
  const roles = [
    { id: "g", permissions: String(VIEW) },
    { id: "r", permissions: String(VIEW | SEND) },
    { id: "admin", permissions: String(1n << 3n) },
  ];
  const ow = (id: string, type: number, allow: bigint, deny: bigint) => ({
    id,
    type,
    allow: String(allow),
    deny: String(deny),
  });
  const bot = (more: string[] = []) => ({ guild: "g", member: "m", roles: more });
  assert.equal(canWrite(bot(), roles, []), false, "@everyone only views");
  assert.equal(canWrite(bot(["r"]), roles, []), true);
  assert.equal(canWrite(bot(["r"]), roles, [ow("r", 0, 0n, SEND)]), false, "a role's overwrite denies");
  assert.equal(canWrite(bot(["r"]), roles, [ow("r", 0, 0n, SEND), ow("m", 1, SEND, 0n)]), true, "the member's wins");
  assert.equal(canWrite(bot(), roles, [ow("g", 0, SEND, 0n)]), true, "@everyone allowed here");
  assert.equal(canWrite(bot(["admin"]), roles, [ow("g", 0, 0n, VIEW | SEND)]), true, "an administrator always can");
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
  // Outside the channel's attention hours only the owner is answered there.
  const closed = { ownerOnly: false, closed: true };
  assert.equal(roomDecision({ mode: "always", called: true, owner: false, ...closed }), "keep");
  assert.equal(roomDecision({ mode: "mention", called: true, owner: true, ...closed }), "reply");
});
