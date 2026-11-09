import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ChannelRooms } from "@apx/protocol";
import { OWNER_ID } from "../domain/persons.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { manualTimers, waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "./whatsapp.ts";

// The owner writes to the line from their own phone (a line of its own), or the line is that phone.
const OWNER_PHONE = { phone: "5491100000009@s.whatsapp.net", name: "Owner" };
const ANA = { phone: "5491100000002@s.whatsapp.net", name: "Ana", lid: "200000000000002@lid" };
const GROUPS = {
  team: "120363000000000001@g.us",
  all: "120363000000000002@g.us",
  unlisted: "120363000000000009@g.us",
  admins: "120363000000000003@g.us",
};

// Answers the room's last message and quotes it, so a test finds its answer by what it says.
const llm = scriptedLlm((req, { said }) => {
  const room = [
    ...String(req.messages.at(-1)?.content).matchAll(/<room_message(?:\s[^>]*)?>([\s\S]*?)<\/room_message>/g),
  ];
  const last = (room.at(-1)?.[1] ?? said).trim();
  return say(`Group answer to: ${last.slice(-60)}`);
});

let env: Awaited<ReturnType<typeof startCore>>;
let wa: ReturnType<typeof fakeWhatsApp>;

// The burst a room waits for runs on these injected runTimers (roomTimers), so a slow machine never splits one.
const timers = manualTimers();
const BURST = 60;
/** Sends, waits until the room has seen the message that waits for the burst, then ends the burst. */
async function settled<T>(send: () => T): Promise<T> {
  const armed = timers.armed();
  const out = send();
  await waitFor(() => timers.armed() > armed, "the room saw the message");
  timers.tick(BURST);
  return out;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const channel = async () => (await env.client.call("channels.list", {})).channels.find((c) => c.id === "whatsapp");
const posts = (group: string) => wa.sent.filter((s) => s.jid === group);
const answerTo = (group: string, words: string) =>
  posts(group).find((p) => String(p.content.text ?? "").includes(words));
const roomThread = (group: string) => env.core.store.threads.byConversation("whatsapp", group);
const kept = (group: string) => {
  const t = roomThread(group);
  return t
    ? env.core.store.messages.list(t.id).map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""))
    : [];
};

const ROOMS = (patch: Partial<ChannelRooms> = {}): ChannelRooms => ({
  rooms: [
    { id: GROUPS.team, name: "Acme team", mode: "mention" },
    { id: GROUPS.all, name: "Acme everyone", mode: "always" },
  ],
  names: ["apx"],
  owner_only: false,
  knowledge: "Acme Notes is a note app.",
  rules: "",
  reply_when: "",
  limits: { user_cooldown_s: 0, room_replies_per_hour: 30, checks_per_hour: 120 },
  ...patch,
});

/** Saves the account; a change of its groups or of whose phone it is reconnects it, anything else does not. */
async function configure(o: { self_owner?: boolean; rooms?: ChannelRooms; reconnects?: boolean } = {}) {
  const before = wa.sockets - (o.reconnects === false ? 1 : 0);
  await env.client.call("channels.set", {
    id: "whatsapp",
    channel: { type: "whatsapp", agent_id: "superagent", self_owner: o.self_owner ?? false, rooms: o.rooms ?? ROOMS() },
  });
  await waitFor(async () => wa.sockets > before && (await channel())?.status === "running", "running again");
}

before(async () => {
  wa = fakeWhatsApp();
  wa.joinGroup(GROUPS.team, "Acme team");
  wa.joinGroup(GROUPS.all, "Acme everyone");
  wa.joinGroup(GROUPS.admins, "Acme news", { announce: true });
  wa.joinGroup("120363000000000004@g.us", "Acme community", { community: true });
  env = await startCore({
    llm,
    roomBurstMs: BURST,
    roomTimers: timers,
    channelAdapters: {
      whatsapp: (c) =>
        whatsappAdapter({
          dir: `${env.home}/wa`,
          selfOwner: c.self_owner === true,
          rooms: (c.rooms?.rooms ?? []).map((r) => r.id),
          lib: async () => wa.lib,
        }),
    },
  });
  env.core.store.persons.owner();
  env.core.store.persons.link(OWNER_ID, { channel: "whatsapp", external_id: OWNER_PHONE.phone, label: "WhatsApp" });
  await env.client.call("channels.set", { id: "whatsapp", channel: { type: "whatsapp", agent_id: "superagent" } });
  await waitFor(async () => Boolean((await channel())?.qr), "a QR");
  wa.scan();
  await waitFor(async () => (await channel())?.status === "running", "linked");
  await configure();
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("the line's groups are offered to pick, each saying whether it may write there; a community is not a group", async () => {
  const { rooms } = await env.client.call("channels.rooms", { channel: "whatsapp" });
  assert.deepEqual(
    rooms.map((r) => [r.name, r.writable]),
    [
      ["Acme everyone", true],
      ["Acme news", false],
      ["Acme team", true],
    ],
  );
  assert.equal(rooms.find((r) => r.name === "Acme team")?.id, GROUPS.team);
});

test("an unlisted group is neither kept nor answered", async () => {
  const calls = llm.calls.length;
  wa.inGroup(ANA, GROUPS.unlisted, "hello", { mention: true });
  await pause(150);
  assert.equal(posts(GROUPS.unlisted).length, 0);
  assert.equal(roomThread(GROUPS.unlisted), undefined, "nothing kept either");
  assert.equal(llm.calls.length, calls);
});

test("a mention group keeps every message and answers only when called, in the group, quoting it", async () => {
  wa.inGroup(ANA, GROUPS.team, "anyone tried the beta?");
  await waitFor(() => kept(GROUPS.team).includes("anyone tried the beta?"), "kept");
  await pause(150);
  assert.equal(posts(GROUPS.team).length, 0, "not called, not answered");

  const asked = await settled(() => wa.inGroup(ANA, GROUPS.team, "what is Acme Notes?", { mention: true }));
  const answer = await waitFor(() => answerTo(GROUPS.team, "what is Acme Notes?"), "answered when @mentioned");
  assert.equal(answer.quoted, asked, "the answer quotes the message it answers");
  assert.ok(kept(GROUPS.team).includes("what is Acme Notes?"), "the line's own @mention is dropped from the text");
  assert.equal(wa.textsTo(ANA.phone).length, 0, "the answer goes to the group, not to the person");
  const thread = roomThread(GROUPS.team);
  const ana = env.core.store.messages.list(thread?.id ?? "").find((m) => m.author.kind === "person");
  assert.equal(ana?.author.kind === "person" ? ana.author.name : "", "Ana", "the sender, by the name they show");

  const reply = posts(GROUPS.team).at(-1)?.id ?? "";
  await settled(() => wa.inGroup(ANA, GROUPS.team, "and on the phone?", { replyTo: reply }));
  await waitFor(() => answerTo(GROUPS.team, "and on the phone?"), "answered as a reply to the line");

  await settled(() => wa.inGroup(ANA, GROUPS.team, "apx, is it free?"));
  await waitFor(() => answerTo(GROUPS.team, "is it free?"), "answered when called by one of its names");
});

test("a group's turn is sealed: no tools, a WhatsApp group, the owner's notes", async () => {
  const call = llm.calls.findLast((c) => String(c.messages[0]?.content).includes("#Acme team"));
  assert.ok(call);
  const system = String(call.messages[0]?.content);
  assert.match(system, /a WhatsApp group/);
  assert.doesNotMatch(system, /owner's own number/);
  assert.match(system, /Acme Notes is a note app/);
  assert.equal(call.tools?.length ?? 0, 0, "no tools in a group");
});

test("an always group answers every message; the owner's phone writing there is the owner", async () => {
  await settled(() => wa.inGroup(ANA, GROUPS.all, "how does sync work?"));
  await waitFor(() => answerTo(GROUPS.all, "how does sync work?"), "answered without a mention");
  await settled(() => wa.inGroup(OWNER_PHONE, GROUPS.all, "status of the beta?"));
  await waitFor(() => answerTo(GROUPS.all, "status of the beta?"), "the owner answered");
  const thread = roomThread(GROUPS.all);
  const owner = env.core.store.messages
    .list(thread?.id ?? "")
    .find((m) => m.parts.some((p) => p.type === "text" && p.text === "status of the beta?"));
  assert.equal(owner?.author.kind, "user", "kept as the owner's words");
});

test("on a line of its own, typing on its phone in a group is nobody's", async () => {
  const calls = llm.calls.length;
  wa.ownerInGroup(GROUPS.all, "typed on the line's phone");
  await pause(150);
  assert.ok(!kept(GROUPS.all).includes("typed on the line's phone"));
  assert.equal(llm.calls.length, calls);
});

test("on the owner's own phone, groups are only read until the owner lets the agent speak there as them", async () => {
  await configure({ self_owner: true });
  const sentBefore = posts(GROUPS.all).length + posts(GROUPS.team).length;
  wa.inGroup(ANA, GROUPS.all, "anyone around tonight?");
  wa.inGroup(ANA, GROUPS.team, "hey there", { mention: true });
  wa.ownerInGroup(GROUPS.team, "apx, what do you think?");
  await waitFor(() => kept(GROUPS.team).includes("apx, what do you think?"), "the owner's own words are kept");
  await waitFor(() => kept(GROUPS.all).includes("anyone around tonight?"), "kept");
  await pause(200);
  assert.equal(posts(GROUPS.all).length + posts(GROUPS.team).length, sentBefore, "nothing said as the owner");
  const team = env.core.store.messages
    .list(roomThread(GROUPS.team)?.id ?? "")
    .find((m) => m.parts.some((p) => p.type === "text" && p.text === "apx, what do you think?"));
  assert.equal(team?.author.kind, "user", "what the owner typed in the group is theirs");

  // An agent asked to post there is refused too: the owner allows it in the account's settings, not a turn.
  await assert.rejects(
    env.client.call("channels.post", { room: "Acme team", text: "hello all", channel: "whatsapp" }),
    /owner's own phone/,
  );
  // So is what the owner asks the agent from the app: its answer stays in the app.
  const thread = roomThread(GROUPS.team)?.id ?? "";
  const answers = () => env.core.store.messages.list(thread).filter((m) => m.author.kind === "agent").length;
  const before = answers();
  await env.client.call("threads.send", { thread, text: "post a hello for everyone" });
  await waitFor(() => answers() > before, "the agent's answer, in the app");
  await pause(150);
  assert.equal(posts(GROUPS.team).length + posts(GROUPS.all).length, sentBefore, "not posted in the group");
});

test("allowed, the agent speaks as the owner only when called by name: an @mention of the owner is not a call", async () => {
  await configure({ self_owner: true, rooms: ROOMS({ as_owner: true }), reconnects: false });
  assert.equal((await channel())?.rooms?.as_owner, true);
  wa.inGroup(ANA, GROUPS.team, "are you coming?", { mention: true });
  await waitFor(() => kept(GROUPS.team).includes(`@${wa.owner.split("@")[0]} are you coming?`), "kept as written");
  await settled(() => wa.ownerInGroup(GROUPS.team, "apx, when is the launch?"));
  await waitFor(() => answerTo(GROUPS.team, "when is the launch?"), "the owner called it by name");
  assert.equal(answerTo(GROUPS.team, "are you coming?"), undefined, "the owner's own @mention did not call it");
  const call = llm.calls.findLast((c) => String(c.messages[0]?.content).includes("#Acme team"));
  assert.match(String(call?.messages[0]?.content), /from your owner's own number/);
});
