// WhatsApp on a line of its own: the agent answers on that number and the owner writes to it from their phone.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "./whatsapp.ts";

const ME = { phone: "5491100000009@s.whatsapp.net", name: "Owner phone" };
const ANA = { phone: "5491100000002@s.whatsapp.net", name: "Ana" };
const BOB = { phone: "5491100000003@s.whatsapp.net", name: "Bob", lid: "200000000000003@lid" };
const CARO = { phone: "5491100000004@s.whatsapp.net", name: "Caro" };

const lastUser = (req: { messages: Array<{ role: string; content?: unknown }> }) =>
  String([...req.messages].reverse().find((m) => m.role === "user")?.content ?? "");
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 160)}`);
  if (said.includes("answer the one who wrote")) {
    const code = /request (\d{6})/.exec(lastUser(req))?.[1] ?? "";
    return callTool("a1", "answer_contact_request", { code, decision: "answer" });
  }
  return say(`Got it: ${said}`);
});

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

test("strangers 'ask': the owner hears who wrote and what; one tap and the first message is answered", async () => {
  await configure({ strangers: "ask" });
  wa.message(ANA, "can you help me?");
  await until(() => wa.textsTo(ME.phone).some((t) => t.includes("+5491100000002")), "the owner is asked");
  const notice = wa.textsTo(ME.phone).find((t) => t.includes("+5491100000002")) ?? "";
  assert.match(notice, /can you help me\?/);
  assert.match(notice, /\*1\* — /);
  assert.deepEqual(wa.textsTo(ANA.phone), [], "nothing reaches the stranger before the owner says so");
  wa.message(ME, "1");
  await until(answered(ANA.phone, "can you help me?"), "her first message answered");
  const { persons } = await env.client.call("contacts.list", {});
  assert.equal(persons.find((p) => p.addresses.some((a) => a.external_id === ANA.phone))?.role, "contact");
});

test("strangers 'ask': the owner can say it to the agent, which sees who waits by code and number, not by the name they chose", async () => {
  wa.message(BOB, "hi there");
  await until(async () => (await env.client.call("pairing.list", {})).requests.some((r) => r.name === "Bob"), "listed");
  const calls = llm.calls.length;
  wa.message(ME, "yes, answer the one who wrote");
  await until(() => llm.calls.length > calls, "the turn");
  const input = lastUser(llm.calls[calls] as { messages: Array<{ role: string; content?: unknown }> });
  assert.match(input, /\[waiting\][\s\S]*request \d{6}: someone on WhatsApp \+5491100000003/);
  assert.ok(!input.includes("Bob"), "the name a stranger chose is not the owner's words");
  // Letting someone in is the owner's act: the agent's call waits for their OK, asked on the same chat.
  await until(() => wa.textsTo(ME.phone).some((t) => t.includes("answer_contact_request")), "the confirmation");
  wa.message(ME, "1");
  await until(answered(BOB.phone, "hi there"), "Bob answered");
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
