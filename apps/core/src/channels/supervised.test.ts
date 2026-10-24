// A supervised contact: never answered on its own; the owner gets the reply the agent would send, and sends it, edits
// it, writes their own or drops it.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { methodAccess } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-supervised";
const OWNER = { id: 1001, name: "Owner" };
const NB = { id: 2201, name: "Northwind Buyer" };
const ACME = { id: 2202, name: "Acme Buyer" };

const DRAFT_NOTE = "Write the message you would send";
let drafts = 0;
const llm = scriptedLlm((req, { said }) => {
  const last = String(req.messages.at(-1)?.content ?? "");
  if (last.includes(DRAFT_NOTE)) {
    drafts++;
    const theirs = req.messages.filter((m) => m.role === "user" && String(m.content).includes("channel_message"));
    if (String(theirs.at(-1)?.content).includes("thanks for nothing")) return say("SKIP");
    return say(`Draft ${drafts}: tomorrow works`);
  }
  return say(`Reply: ${said.slice(0, 80)}`);
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;
let nb = "";
let thread = "";

type Markup = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
const toOwner = () => tg.messagesTo(OWNER.id).map((m) => m.body);
const lastNotice = () => toOwner().findLast((b) => b.reply_markup);
const buttons = (b: Record<string, unknown> | undefined) =>
  ((b?.reply_markup as Markup | undefined)?.inline_keyboard ?? []).map((r) => r[0] ?? { text: "", callback_data: "" });
const pending = async (person = nb) => (await env.client.call("contacts.suggestions.list", { person })).suggestions;
const chat = async () =>
  (await env.client.call("threads.get", { thread })).messages.map((m) => ({
    author: m.author.kind,
    text: m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""),
  }));

/** A message from a supervised contact and the notice it brings the owner. */
async function noticeFor(from: typeof NB, text: string) {
  const before = toOwner().length;
  tg.message(from, text);
  await waitFor(
    () =>
      toOwner()
        .slice(before)
        .some((b) => b.reply_markup),
    `a notice for "${text}"`,
  );
  return lastNotice();
}

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({
    llm,
    suggestBurstMs: 80,
    channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) },
  });
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
  await env.client.call("contacts.address", { channel: "tg", address: String(OWNER.id) });
  const p = await env.client.call("contacts.set", {
    name: NB.name,
    relation: "client",
    rules: "Never confirm a date without the owner.",
    supervised: true,
  });
  nb = p.id;
  await env.client.call("contacts.address", { channel: "tg", address: String(NB.id), person: nb });
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

test("only the owner may read or decide drafts", () => {
  for (const m of ["contacts.suggestions.list", "contacts.suggestions.send", "contacts.suggestions.discard"] as const)
    assert.equal(methodAccess(m), "human");
});

test("a burst of messages gets one draft, nothing goes to the contact, and the owner sees all of it", async () => {
  const calls = llm.calls.length;
  tg.message(NB, "hi there");
  tg.message(NB, "can we meet tomorrow?");
  await waitFor(() => Boolean(lastNotice()), "the notice");
  const notice = lastNotice();
  const text = String(notice?.text);
  assert.match(text, /Northwind Buyer te escribió por Telegram/);
  assert.match(text, /«hi there»\n«can we meet tomorrow\?»/, "every message, oldest first");
  assert.match(text, /Draft 1: tomorrow works/);
  assert.deepEqual(
    buttons(notice).map((b) => b.text),
    ["Mandar esta", "Contestar yo", "Ignorar"],
  );
  assert.deepEqual(tg.messagesTo(NB.id), [], "nothing reached the contact");
  assert.equal(llm.calls.length - calls, 1, "one model call for the burst, no turn");
  const call = llm.calls.at(-1);
  assert.deepEqual(call?.tools, [], "a draft has no tools");
  const system = String(call?.messages[0]?.content);
  assert.match(system, /You are chatting with Northwind Buyer, a client of your owner/);
  assert.ok(system.trim().endsWith("Never confirm a date without the owner."), "the owner's rules, last");
  const [s] = await pending();
  assert.deepEqual(
    [s?.state, s?.said, s?.text],
    ["pending", ["hi there", "can we meet tomorrow?"], "Draft 1: tomorrow works"],
  );
  thread = s?.thread_id ?? "";
  const tray = await env.client.call("notifications.list", {});
  assert.ok(
    tray.notifications.some((n) => n.ref === `suggestion:${s?.id}` && !n.read_at),
    "the tray has it too",
  );
});

test("'Mandar esta' sends the draft as the agent's message in their chat", async () => {
  const [s] = await pending();
  const send = buttons(lastNotice()).find((b) => b.text === "Mandar esta");
  tg.press(OWNER, send?.callback_data ?? "");
  await waitFor(() => tg.messagesTo(NB.id).length === 1, "sent to the contact");
  assert.equal(tg.messagesTo(NB.id)[0]?.body.text, "Draft 1: tomorrow works");
  await waitFor(() => toOwner().some((b) => b.text === "Listo: se lo mandé a Northwind Buyer."), "the owner is told");
  assert.deepEqual((await chat()).at(-1), { author: "agent", text: "Draft 1: tomorrow works" });
  assert.deepEqual(await pending(), []);
  const tray = await env.client.call("notifications.list", {});
  assert.ok(tray.notifications.find((n) => n.ref === `suggestion:${s?.id}`)?.read_at, "gone from the tray");
  const [sent] = (await env.client.call("contacts.suggestions.list", { state: "sent" })).suggestions;
  assert.equal(sent?.id, s?.id);
  assert.ok(sent?.message_id);
  // Pressed again: nothing goes twice.
  tg.press(OWNER, send?.callback_data ?? "");
  await waitFor(() => toOwner().some((b) => /ya no está pendiente/.test(String(b.text))), "already decided");
  assert.equal(tg.messagesTo(NB.id).length, 1);
});

test("the next draft reads what was sent, and an app can send it edited", async () => {
  await noticeFor(NB, "and the price?");
  const drafted = llm.calls.at(-1)?.messages ?? [];
  assert.ok(
    drafted.some((m) => m.role === "assistant" && m.content === "Draft 1: tomorrow works"),
    "the sent draft is the agent's own words in what it reads",
  );
  const [s] = await pending();
  assert.deepEqual(s?.said, ["and the price?"], "only what came after the last answer");
  const r = await env.client.call("contacts.suggestions.send", {
    id: s?.id ?? "",
    text: "The owner will send it today.",
  });
  assert.equal(r.suggestion.state, "sent");
  assert.notEqual(r.delivery.state, "failed");
  await waitFor(() => tg.messagesTo(NB.id).length === 2, "the edited text");
  assert.equal(tg.messagesTo(NB.id)[1]?.body.text, "The owner will send it today.");
  await assert.rejects(env.client.call("contacts.suggestions.send", { id: s?.id ?? "" }), /is sent/);
});

test("'Contestar yo': the owner's next words go to the contact as theirs", async () => {
  const notice = await noticeFor(NB, "are you there?");
  const calls = llm.calls.length;
  tg.press(OWNER, buttons(notice).find((b) => b.text === "Contestar yo")?.callback_data ?? "");
  await waitFor(() => toOwner().some((b) => /Escribí tu respuesta para Northwind Buyer/.test(String(b.text))), "asked");
  tg.message(OWNER, "Yes, calling you in 5");
  await waitFor(() => tg.messagesTo(NB.id).length === 3, "their words sent");
  assert.equal(tg.messagesTo(NB.id)[2]?.body.text, "Yes, calling you in 5");
  assert.deepEqual((await chat()).at(-1), { author: "user", text: "Yes, calling you in 5" });
  assert.deepEqual(await pending(), []);
  assert.equal(llm.calls.length, calls, "the words never reached the agent");
});

test("'Contestar yo' then 'cancelar' sends nothing, and the draft stays pending", async () => {
  const notice = await noticeFor(NB, "still there?");
  tg.press(OWNER, buttons(notice).find((b) => b.text === "Contestar yo")?.callback_data ?? "");
  await waitFor(() => toOwner().filter((b) => /Escribí tu respuesta/.test(String(b.text))).length === 2, "asked");
  tg.message(OWNER, "cancelar");
  await waitFor(() => toOwner().some((b) => b.text === "Listo, no le mando nada."), "canceled");
  assert.equal(tg.messagesTo(NB.id).length, 3);
  const [s] = await pending();
  assert.equal(s?.state, "pending");
  await env.client.call("contacts.suggestions.discard", { id: s?.id ?? "" });
});

test("'Ignorar' sends nothing and keeps them supervised", async () => {
  const notice = await noticeFor(NB, "hello again");
  tg.press(OWNER, buttons(notice).find((b) => b.text === "Ignorar")?.callback_data ?? "");
  await waitFor(() => toOwner().some((b) => b.text === "Listo: no le contesto a Northwind Buyer."), "dropped");
  assert.deepEqual(await pending(), []);
  assert.equal(tg.messagesTo(NB.id).length, 3);
  const p = (await env.client.call("contacts.list", {})).persons.find((x) => x.id === nb);
  assert.equal(p?.supervised, true);
});

test("a newer message replaces the pending draft; the old one can no longer be sent", async () => {
  await noticeFor(NB, "first question");
  const [old] = await pending();
  await noticeFor(NB, "second question");
  const list = await pending();
  assert.equal(list.length, 1);
  assert.notEqual(list[0]?.id, old?.id);
  assert.deepEqual(list[0]?.said, ["first question", "second question"], "the new draft answers both");
  await assert.rejects(env.client.call("contacts.suggestions.send", { id: old?.id ?? "" }), /superseded/);
  const r = await env.client.call("contacts.suggestions.discard", { id: list[0]?.id ?? "" });
  assert.equal(r.suggestion.state, "discarded");
});

test("a draft that says nothing needs an answer offers no 'Mandar esta'", async () => {
  const notice = await noticeFor(NB, "thanks for nothing");
  assert.match(String(notice?.text), /No te sugiero respuesta: parece que no hace falta contestar/);
  assert.deepEqual(
    buttons(notice).map((b) => b.text),
    ["Contestar yo", "Ignorar"],
  );
  const [s] = await pending();
  assert.equal(s?.text, "");
  await assert.rejects(env.client.call("contacts.suggestions.send", { id: s?.id ?? "" }), /no draft/);
  await env.client.call("contacts.suggestions.discard", { id: s?.id ?? "" });
});

test("silenced and supervised exclude each other; choosing either is the owner's review", async () => {
  let p = await env.client.call("contacts.set", { id: nb, name: NB.name, muted: true });
  assert.deepEqual([p.muted, p.supervised], [true, false]);
  const sent = toOwner().length;
  tg.message(NB, "anyone?");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(toOwner().length, sent, "a silenced contact brings no draft");
  p = await env.client.call("contacts.set", { id: nb, name: NB.name, supervised: true });
  assert.deepEqual([p.muted, p.supervised], [false, true]);
  p = await env.client.call("contacts.set", { id: nb, name: NB.name, supervised: false });
  assert.deepEqual([p.muted, p.supervised], [false, false]);
  await env.client.call("contacts.set", { id: nb, name: NB.name, supervised: true });
});

test("past the hourly cap of drafts their messages are only kept, and the owner hears it once", async () => {
  const acme = await env.client.call("contacts.set", { name: ACME.name, supervised: true });
  await env.client.call("contacts.address", { channel: "tg", address: String(ACME.id), person: acme.id });
  for (let i = 0; i < 10; i++) await noticeFor(ACME, `message ${i}`);
  const calls = llm.calls.length;
  tg.message(ACME, "message 10");
  await waitFor(() => toOwner().some((b) => /Acme Buyer escribe mucho seguido/.test(String(b.text))), "told once");
  tg.message(ACME, "message 11");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(llm.calls.length, calls, "no more model calls");
  assert.equal(toOwner().filter((b) => /Acme Buyer escribe mucho seguido/.test(String(b.text))).length, 1);
  assert.deepEqual(tg.messagesTo(ACME.id), []);
});
