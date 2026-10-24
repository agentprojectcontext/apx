// WhatsApp on a line of its own: the agent answers on that number and the owner writes to it from their phone.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore, throughOwnerCheck } from "../engine/testkit.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "./whatsapp.ts";

const ME = { phone: "5491100000009@s.whatsapp.net", name: "Owner phone" };
const ANA = { phone: "5491100000002@s.whatsapp.net", name: "Ana" };
const BOB = { phone: "5491100000003@s.whatsapp.net", name: "Bob", lid: "200000000000003@lid" };
const CARO = { phone: "5491100000004@s.whatsapp.net", name: "Caro" };

const lastUser = (req: { messages: Array<{ role: string; content?: unknown }> }) =>
  String([...req.messages].reverse().find((m) => m.role === "user")?.content ?? "");
const llm = scriptedLlm(
  throughOwnerCheck((req, { said, afterTool }) => {
    if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 160)}`);
    if (said.includes("answer the one who wrote")) {
      const who = /- (?:request|contact) (\S+):/.exec(lastUser(req))?.[1] ?? "";
      return callTool("a1", "answer_contact_request", { who, decision: "answer" });
    }
    return say(`Got it: ${said}`);
  }),
);

let env: Awaited<ReturnType<typeof startCore>>;
const wa = fakeWhatsApp();

const until = async (check: () => boolean | Promise<boolean>, what: string, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`never: ${what}`);
};
const channel = async () => (await env.client.call("channels.list", {})).channels.find((c) => c.id === "whatsapp");
const owner = async () => (await env.client.call("contacts.list", {})).persons.find((p) => p.role === "owner");
const configure = async (patch: Record<string, unknown>) => {
  await env.client.call("channels.set", {
    id: "whatsapp",
    channel: { type: "whatsapp", agent_id: "roby", ...patch },
  });
  await until(async () => (await channel())?.status === "running", "running again");
};
const answered = (to: string, words: string) => () =>
  wa.textsTo(to).some((t) => t.includes(`Got it:`) && t.includes(words));

before(async () => {
  env = await startCore({
    llm,
    channelAdapters: {
      whatsapp: (c) =>
        whatsappAdapter({ dir: `${env.home}/wa`, selfOwner: c.self_owner === true, lib: async () => wa.lib }),
    },
  });
  await env.client.call("channels.set", { id: "whatsapp", channel: { type: "whatsapp", agent_id: "roby" } });
  await until(async () => Boolean((await channel())?.qr), "a QR");
  wa.scan();
  await until(async () => (await channel())?.status === "running", "linked");
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("a line of its own is nobody: its 'Message yourself' gets no answer and the owner has no address on it yet", async () => {
  assert.ok(!(await owner())?.addresses.some((a) => a.channel === "whatsapp"));
  const calls = llm.calls.length;
  wa.fromOwner("hello from the line itself");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(llm.calls.length, calls);
});

test("the owner writes from their phone, gets a code, and once it is typed in APX their words are answered", async () => {
  wa.message(ME, "it's me");
  await until(() => wa.textsTo(ME.phone).length === 1, "the code");
  const sent = wa.textsTo(ME.phone)[0] ?? "";
  assert.match(sent, /WhatsApp/, "the code says where to type it: this channel, not another");
  const code = /(\d{6})/.exec(sent)?.[1] ?? "";
  await env.client.call("pairing.respond", { code, decision: "owner" });
  wa.message(ME, "what is on today?");
  await until(answered(ME.phone, "what is on today?"), "the owner's answer");
});

test("the owner's number can also be typed in by hand", async () => {
  const before = await owner();
  const address = before?.addresses.find((a) => a.channel === "whatsapp");
  if (address) await env.client.call("contacts.remove", { address: address.id });
  await assert.rejects(env.client.call("contacts.address", { channel: "whatsapp", address: "12-34" }));
  const p = await env.client.call("contacts.address", { channel: "whatsapp", address: "+54 9 11 0000-0009" });
  assert.equal(p.role, "owner");
  assert.ok(p.addresses.some((a) => a.external_id === ME.phone));
  wa.message(ME, "typed by hand");
  await until(answered(ME.phone, "typed by hand"), "answered as the owner");
});

const personAt = async (phone: string) =>
  (await env.client.call("contacts.list", {})).persons.find((p) => p.addresses.some((a) => a.external_id === phone));

test("strangers 'ask': whoever writes shows in their own chat, unanswered and reported; only the app lets them in", async () => {
  await configure({ strangers: "ask" });
  const reports = () => wa.textsTo(ME.phone).filter((t) => t.includes("+5491100000002"));
  wa.message(ANA, "can you help me?");
  await until(() => reports().length === 1, "the owner is told");
  assert.match(reports()[0] ?? "", /can you help me\?/);
  assert.doesNotMatch(reports()[0] ?? "", /\*1\* — /, "no options off Telegram");
  assert.match(reports()[0] ?? "", /no por este canal/, "it says where to answer");
  const ana = await personAt(ANA.phone);
  assert.deepEqual([ana?.role, ana?.muted, ana?.unreviewed], ["contact", true, true], "kept as an unreviewed contact");
  const thread = await env.client.call("channels.open", { person: ana?.id ?? "", channel: "whatsapp" });
  const said = (await env.client.call("threads.get", { thread: thread.id })).messages.map((m) =>
    JSON.stringify(m.parts),
  );
  assert.ok(
    said.some((p) => p.includes("can you help me?")),
    "her words are in her chat",
  );
  wa.message(ANA, "it's urgent");
  await until(() => reports().length === 2, "each message is reported");
  assert.deepEqual(wa.textsTo(ANA.phone), [], "nothing reaches her before the owner says so");
  // A typed "1" is only words to the agent; the owner decides in the app.
  wa.message(ME, "1");
  await until(answered(ME.phone, "1"), "the number is relayed as words");
  assert.equal((await personAt(ANA.phone))?.muted, true, "a number on the channel lets nobody in");
  await env.client.call("contacts.set", { id: ana?.id ?? "", name: ana?.name ?? "", muted: false });
  await until(async () => (await personAt(ANA.phone))?.muted === false, "answered from now on");
  assert.equal((await personAt(ANA.phone))?.unreviewed, false);
  wa.message(ANA, "still there?");
  await until(answered(ANA.phone, "still there?"), "her next message answered");
});

test("strangers 'ask': the owner's words on WhatsApp let nobody in; said in the app, the agent sees who waits by id and number, not by the name they chose", async () => {
  wa.message(BOB, "hi there");
  await until(async () => (await personAt(BOB.phone))?.unreviewed === true, "kept");
  const calls = llm.calls.length;
  wa.message(ME, "yes, let in the one who wrote");
  await until(answered(ME.phone, "let in the one who wrote"), "relayed like any words");
  assert.ok(
    llm.calls.slice(calls).every((c) => !lastUser(c as never).includes("[waiting]")),
    "who waits is not handed to a turn that began on a channel",
  );
  assert.equal((await personAt(BOB.phone))?.muted, true, "words on the channel let nobody in");

  const inApp = llm.calls.length;
  await env.client.call("threads.send", { thread: "home", text: "yes, answer the one who wrote" });
  await until(() => llm.calls.length > inApp, "the turn");
  const input = lastUser(llm.calls[inApp] as { messages: Array<{ role: string; content?: unknown }> });
  assert.match(input, /\[waiting\][\s\S]*contact \S+: someone on WhatsApp \+5491100000003/);
  assert.ok(!input.includes("Bob"), "the name a stranger chose is not the owner's words");
  // Letting someone in is the owner's act: the agent's call waits for their OK, which only the app gives.
  await until(async () => (await env.client.call("runs.pending", {})).inputs.length > 0, "the confirmation");
  const confirm = (await env.client.call("runs.pending", {})).inputs[0]?.id ?? "";
  assert.equal((await personAt(BOB.phone))?.muted, true, "not before the owner's OK");
  await env.client.call("runs.respond", { input: confirm, decision: "approve" });
  await until(async () => (await personAt(BOB.phone))?.muted === false, "Bob let in");
  wa.message(BOB, "hi again");
  await until(answered(BOB.phone, "hi again"), "Bob answered");
});

test("strangers 'ask': ignoring someone keeps them silenced, their messages kept and no longer reported; a typed number ignores nobody", async () => {
  const dan = { phone: "5491100000005@s.whatsapp.net", name: "Dan" };
  const reports = () => wa.textsTo(ME.phone).filter((t) => t.includes("+5491100000005"));
  wa.message(dan, "promo for you");
  await until(() => reports().length === 1, "reported");
  wa.message(ME, "2");
  await until(answered(ME.phone, "2"), "the number is relayed as words");
  assert.equal((await personAt(dan.phone))?.unreviewed, true, "a number on the channel reviews nobody");
  const person = await personAt(dan.phone);
  await env.client.call("contacts.set", { id: person?.id ?? "", name: person?.name ?? "", muted: true });
  await until(async () => (await personAt(dan.phone))?.unreviewed === false, "reviewed");
  assert.equal((await personAt(dan.phone))?.muted, true);
  wa.message(dan, "another promo");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(reports().length, 1, "no more reports");
  assert.deepEqual(wa.textsTo(dan.phone), [], "never answered");
});

test("changing who answers, where the owner's words go or what strangers get keeps the connection up", async () => {
  const before = wa.sockets;
  await env.client.call("channels.set", {
    id: "whatsapp",
    channel: { type: "whatsapp", agent_id: "roby", strangers: "ignore", owner_thread: "own", concurrency: "steer" },
  });
  assert.equal((await channel())?.status, "running");
  assert.equal(wa.sockets, before, "no reconnect");
  assert.equal((await channel())?.strangers, "ignore");
});

test("strangers 'answer': a new person is answered at once, as a contact", async () => {
  await configure({ strangers: "answer" });
  wa.message(CARO, "hello?");
  await until(answered(CARO.phone, "hello?"), "answered");
  const { persons } = await env.client.call("contacts.list", {});
  assert.equal(persons.find((p) => p.name === "Caro")?.role, "contact");
});

test("the line turned out to be the owner's own phone: 'Message yourself' is the owner; turned back, it is nobody again", async () => {
  await configure({ strangers: "pair", self_owner: true });
  assert.ok((await owner())?.addresses.some((a) => a.external_id === wa.owner));
  wa.fromOwner("from my own phone");
  await until(answered(wa.owner, "from my own phone"), "answered in Message yourself");
  await configure({ strangers: "pair", self_owner: false });
  assert.ok(!(await owner())?.addresses.some((a) => a.external_id === wa.owner));
});
