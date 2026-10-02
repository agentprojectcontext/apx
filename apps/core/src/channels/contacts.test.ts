import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-contacts";
const MAG = { id: 2201, name: "Northwind Buyer" };

const llm = scriptedLlm((_req, { said }) => say(`Reply: ${said.split("\n").at(-1)?.slice(0, 80)}`));

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;
let thread = "";
let person = "";

const until = async (check: () => boolean | Promise<boolean>, what: string, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
};

/** A stranger writes, the owner approves them as a contact; returns the contact's chat. */
async function pairContact(): Promise<string> {
  tg.message(MAG, "hello");
  await until(() => tg.messagesTo(MAG.id).length === 1, "pairing code");
  const code = /(\d{6})/.exec(String(tg.messagesTo(MAG.id)[0]?.body.text))?.[1] ?? "";
  await env.client.call("pairing.respond", { code, decision: "contact", name: MAG.name });
  tg.message(MAG, "first words");
  let id = "";
  await until(async () => {
    id = (await env.client.call("threads.list", {})).threads.find((t) => t.title === MAG.name)?.id ?? "";
    return Boolean(id);
  }, "contact thread");
  await until(() => tg.messagesTo(MAG.id).length >= 2, "first answer");
  return id;
}

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({ llm, channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  await until(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
  thread = await pairContact();
  person = (await env.client.call("contacts.list", {})).persons.find((p) => p.name === MAG.name)?.id ?? "";
  assert.ok(person);
});
after(async () => {
  await env.core.close();
  await tg.close();
  env.cleanup();
});

test("who they are and the owner's rules reach the contact's turns, the rules last", async () => {
  const p = await env.client.call("contacts.set", {
    id: person,
    name: MAG.name,
    nickname: "NB",
    relation: "client",
    note: "Buys for Northwind.",
    rules: "Never quote prices without the owner.",
  });
  assert.equal(p.relation, "client");
  assert.equal(p.muted, false);
  assert.deepEqual(p.perms, { appointments: false, requests: false, notes: false });
  tg.message(MAG, "any news?");
  await until(() => tg.messagesTo(MAG.id).length >= 3, "answer");
  const system = String(llm.calls.at(-1)?.messages[0]?.content);
  assert.match(system, /Northwind Buyer \("NB"\), a client of your owner/);
  assert.match(system, /Buys for Northwind\./);
  assert.ok(system.trim().endsWith("Never quote prices without the owner."), "the owner's rules go last");
});

test("a silenced contact's message is kept and unread, never answered", async () => {
  await env.client.call("contacts.set", { id: person, name: MAG.name, muted: true });
  const sent = tg.messagesTo(MAG.id).length;
  const calls = llm.calls.length;
  tg.message(MAG, "are you there?");
  await until(async () => {
    const { messages } = await env.client.call("threads.get", { thread });
    return messages.some((m) => m.parts[0]?.type === "text" && m.parts[0].text === "are you there?");
  }, "message kept");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(tg.messagesTo(MAG.id).length, sent, "nothing went back");
  assert.equal(llm.calls.length, calls, "no model call");
  const t = (await env.client.call("threads.get", { thread })).thread;
  assert.ok(t.unread > 0);
  await env.client.call("contacts.set", { id: person, name: MAG.name, muted: false });
});

test("the owner tells the agent what to answer in the app; the answer goes to the contact", async () => {
  const sent = tg.messagesTo(MAG.id).length;
  await env.client.call("threads.send", { thread, text: "tell them it ships on Friday" });
  await until(() => tg.messagesTo(MAG.id).length > sent, "answer on the channel");
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(input, /<owner_instruction>\ntell them it ships on Friday\n<\/owner_instruction>/);
});

test("the owner writes to the contact themselves: sent as is, kept as the owner's words", async () => {
  const sent = tg.messagesTo(MAG.id).length;
  const calls = llm.calls.length;
  await env.client.call("channels.send", { thread, text: "Hi, it's me. Friday it is." });
  await until(() => tg.messagesTo(MAG.id).length > sent, "sent");
  assert.match(String(tg.messagesTo(MAG.id).at(-1)?.body.text), /Friday it is/);
  assert.equal(llm.calls.length, calls, "no model call");
  const { messages } = await env.client.call("threads.get", { thread });
  assert.equal(messages.at(-1)?.author.kind, "user");
  await assert.rejects(env.client.call("channels.send", { thread: "home", text: "x" }), /contact's chat/);
});
