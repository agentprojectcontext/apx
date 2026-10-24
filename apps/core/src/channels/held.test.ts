import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-hours";
const OWNER = { id: 4401, name: "Owner" };
const BUYER = { id: 4402, name: "Northwind Buyer" };
const FAMILY = { id: 4403, name: "Acme Cousin" };
const ZONE = "America/Argentina/Buenos_Aires";
/** Every day from 08:00 to 22:00 in the owner's time zone. */
const HOURS = { days: [0, 1, 2, 3, 4, 5, 6], from: "08:00", to: "22:00" };

const llm = scriptedLlm((req, { said }) => {
  const input = String(req.messages.at(-1)?.content);
  if (input.includes("outside its attention hours")) {
    const night = req.messages.filter((m) => /are you open|price list/.test(String(m.content))).length;
    return say(`Good morning, answering ${night} messages.`);
  }
  return say(`Reply: ${said.split("\n").at(-1)?.slice(0, 60)}`);
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;
// 2026-10-21 23:30 in Buenos Aires (UTC-3): after the hours. The machine's own zone does not matter.
let clock = new Date("2026-10-22T02:30:00Z");
const persons: Record<string, string> = {};

const texts = (who: { id: number }) => tg.messagesTo(who.id).map((m) => String(m.body.text));
const kept = async (thread: string, text: string) =>
  (await env.client.call("threads.get", { thread })).messages.some(
    (m) => m.parts[0]?.type === "text" && m.parts[0].text === text,
  );
const threadOf = async (name: string) =>
  (await env.client.call("threads.list", {})).threads.find((t) => t.title === name)?.id ?? "";

async function pair(who: { id: number; name: string }, decision: "owner" | "contact") {
  tg.message(who, "hello");
  await waitFor(() => texts(who).length === 1, "pairing code");
  const code = /(\d{6})/.exec(texts(who)[0] ?? "")?.[1] ?? "";
  const { person } = await env.client.call("pairing.respond", {
    code,
    decision,
    ...(decision === "contact" ? { name: who.name } : {}),
  });
  if (person) persons[who.name] = person.id;
}

const startOn = (home?: string) =>
  startCore({
    llm,
    ...(home ? { home } : {}),
    clock: () => clock,
    suggestBurstMs: 20,
    channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) },
  });

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startOn();
  env.core.store.settings.write("owner_profile", { about: "", timezone: ZONE });
  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "roby", hours: HOURS },
    token: TOKEN,
  });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
  await pair(OWNER, "owner");
  await pair(BUYER, "contact");
  await pair(FAMILY, "contact");
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

test("the channel keeps its hours as the owner set them", async () => {
  const { channels } = await env.client.call("channels.list", {});
  assert.deepEqual(channels[0]?.hours, HOURS);
});

test("a contact who writes after the hours is kept unanswered, with no model call", async () => {
  const calls = llm.calls.length;
  const sent = texts(BUYER).length;
  tg.message(BUYER, "are you open tomorrow?");
  tg.message(BUYER, "and can you send the price list?");
  let thread = "";
  await waitFor(async () => {
    thread = await threadOf(BUYER.name);
    return thread !== "" && (await kept(thread, "and can you send the price list?"));
  }, "kept");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(texts(BUYER).length, sent, "nothing went back");
  assert.equal(llm.calls.length, calls, "no model call");
  assert.ok((await env.client.call("threads.get", { thread })).thread.unread > 0, "unread for the owner");
  assert.equal(env.core.store.channels.held.get(thread)?.person_id, persons[BUYER.name]);
});

test("the owner is answered at any hour", async () => {
  const sent = texts(OWNER).length;
  tg.message(OWNER, "still up?");
  await waitFor(() => texts(OWNER).length > sent, "the owner's answer");
  assert.match(texts(OWNER).at(-1) ?? "", /Reply: still up\?/);
});

test("a contact the owner answers at any hour is answered after the hours too", async () => {
  await env.client.call("contacts.set", { id: persons[FAMILY.name] ?? "", name: FAMILY.name, any_hour: true });
  const sent = texts(FAMILY).length;
  tg.message(FAMILY, "dinner on Sunday?");
  await waitFor(() => texts(FAMILY).length > sent, "an answer at night");
  assert.equal(env.core.store.channels.held.get(await threadOf(FAMILY.name)), undefined);
});

test("before the hours begin the office clock opens nothing", async () => {
  clock = new Date("2026-10-22T10:59:00Z"); // 07:59
  const calls = llm.calls.length;
  env.core.scheduler.tick();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(llm.calls.length, calls);
  assert.ok(env.core.store.channels.held.get(await threadOf(BUYER.name)));
});

test("once the hours begin the chat gets one turn that answers all of the night's messages", async () => {
  clock = new Date("2026-10-22T11:00:00Z"); // 08:00
  const sent = texts(BUYER).length;
  env.core.scheduler.tick();
  await waitFor(() => texts(BUYER).length > sent, "the morning answer");
  assert.deepEqual(texts(BUYER).slice(sent), ["Good morning, answering 2 messages."]);
  const thread = await threadOf(BUYER.name);
  assert.equal(env.core.store.channels.held.get(thread), undefined);
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(input, /Northwind Buyer, a contact of your owner/);
  assert.match(input, /not your owner/);
  env.core.scheduler.tick();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(texts(BUYER).length, sent + 1, "answered once");
});

test("a message in the hours before the clock opens the chat is answered once, by its own turn", async () => {
  clock = new Date("2026-10-23T01:30:00Z"); // 22:30
  tg.message(BUYER, "one more question");
  const thread = await threadOf(BUYER.name);
  await waitFor(() => Boolean(env.core.store.channels.held.get(thread)), "held");
  clock = new Date("2026-10-23T11:05:00Z"); // 08:05, before any tick
  const sent = texts(BUYER).length;
  tg.message(BUYER, "hello again");
  await waitFor(() => texts(BUYER).length > sent, "the answer");
  assert.equal(env.core.store.channels.held.get(thread), undefined);
  env.core.scheduler.tick();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(texts(BUYER).length, sent + 1, "not answered twice");
});

test("a supervised contact gets its draft once the hours begin, not at night", async () => {
  const id = persons[BUYER.name] ?? "";
  await env.client.call("contacts.set", { id, name: BUYER.name, supervised: true });
  clock = new Date("2026-10-24T02:00:00Z"); // 23:00
  tg.message(BUYER, "is the order ready?");
  const thread = await threadOf(BUYER.name);
  await waitFor(async () => await kept(thread, "is the order ready?"), "kept");
  await new Promise((r) => setTimeout(r, 300));
  const drafts = async () => (await env.client.call("contacts.suggestions.list", { person: id })).suggestions.length;
  assert.equal(await drafts(), 0, "no draft at night");
  clock = new Date("2026-10-24T11:00:00Z");
  env.core.scheduler.tick();
  await waitFor(async () => (await drafts()) === 1, "a draft in the morning");
  await env.client.call("contacts.set", { id, name: BUYER.name, supervised: false });
});

test("a silenced contact's chat stops waiting: nothing is answered for them", async () => {
  const id = persons[BUYER.name] ?? "";
  clock = new Date("2026-10-25T02:00:00Z");
  tg.message(BUYER, "last one tonight");
  const thread = await threadOf(BUYER.name);
  await waitFor(() => Boolean(env.core.store.channels.held.get(thread)), "held");
  await env.client.call("contacts.set", { id, name: BUYER.name, muted: true });
  clock = new Date("2026-10-25T11:00:00Z");
  const calls = llm.calls.length;
  env.core.scheduler.tick();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(env.core.store.channels.held.get(thread), undefined);
  assert.equal(llm.calls.length, calls);
  await env.client.call("contacts.set", { id, name: BUYER.name, muted: false });
});

test("a chat waiting overnight still opens after the core restarts", async () => {
  clock = new Date("2026-10-26T02:00:00Z");
  tg.message(BUYER, "are you open on Monday?");
  const thread = await threadOf(BUYER.name);
  await waitFor(() => Boolean(env.core.store.channels.held.get(thread)), "held");
  const dir = env.home;
  await env.core.close();
  clock = new Date("2026-10-26T11:00:00Z");
  const sent = texts(BUYER).length;
  env = await startOn(dir);
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
  env.core.scheduler.tick();
  await waitFor(() => texts(BUYER).length > sent, "answered after the restart");
  assert.equal(env.core.store.channels.held.get(thread), undefined);
});
