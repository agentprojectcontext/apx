import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import type { AdapterIO } from "./types.ts";
import { toWhatsApp, whatsappAdapter } from "./whatsapp.ts";

const ANA = { phone: "5491100000002@s.whatsapp.net", name: "Ana" };
const BOB = { phone: "5491100000003@s.whatsapp.net", name: "Bob", lid: "200000000000003@lid" };

const llm = scriptedLlm((_req, { said }) => say(`Got it: ${said}`));
let env: Awaited<ReturnType<typeof startCore>>;
let wa: ReturnType<typeof fakeWhatsApp>;

const until = async (check: () => boolean | Promise<boolean>, what: string, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`never: ${what}`);
};
const channel = async () => (await env.client.call("channels.list", {})).channels.find((c) => c.id === "whatsapp");

before(async () => {
  wa = fakeWhatsApp();
  env = await startCore({
    llm,
    channelAdapters: {
      whatsapp: (c) =>
        whatsappAdapter({ dir: `${envDir()}/wa`, selfOwner: c.self_owner === true, lib: async () => wa.lib }),
    },
  });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});
// The credentials live in the core's own temp home.
const envDir = () => env.home;

test("linking the owner's own phone: a QR waits in the app, and once scanned the number is the owner's address", async () => {
  await env.client.call("channels.set", {
    id: "whatsapp",
    channel: { type: "whatsapp", agent_id: "roby", self_owner: true },
  });
  await until(async () => Boolean((await channel())?.qr), "a QR to scan");
  const waiting = await channel();
  assert.equal(waiting?.status, "starting");
  assert.equal(waiting?.label, "WhatsApp");

  wa.scan();
  await until(async () => (await channel())?.status === "running", "linked");
  const linked = await channel();
  assert.equal(linked?.qr, undefined, "the QR is gone once spent");
  assert.equal(linked?.account, "+5491100000001");
  const { persons } = await env.client.call("contacts.list", {});
  assert.ok(persons.find((p) => p.role === "owner")?.addresses.some((a) => a.external_id === wa.owner));
  assert.equal((fs.statSync(wa.dir).mode & 0o777).toString(8), "700", "the credentials folder is private");
});

test("a person's profile picture comes from the channel, kept as media; one who shows none has none", async () => {
  const { media_id } = await env.client.call("contacts.avatar", { person: "owner" });
  assert.ok(media_id, "the line's own picture");
  assert.equal((await env.client.call("media.get", { id: media_id ?? "" })).mime, "image/png");
  assert.deepEqual(
    await env.client.call("contacts.avatar", { person: "owner" }),
    { media_id },
    "kept, not asked again",
  );
});

test("codes keep coming for a few rounds while nobody scans, then linking waits for the owner", async () => {
  const fake = fakeWhatsApp();
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/apx-wa-`);
  const adapter = whatsappAdapter({ dir, lib: async () => fake.lib });
  const codes: string[] = [];
  const states: string[] = [];
  const ac = new AbortController();
  await adapter.start({
    receive: () => {},
    action: () => {},
    status: (s, e) => states.push(`${s}:${e ?? ""}`),
    qr: (c) => c && codes.push(c),
    signal: ac.signal,
  });
  for (let i = 0; i < 3; i++) {
    await until(() => codes.length === i + 1, `code ${i + 1}`);
    fake.expire();
  }
  await until(() => codes.length === 4, "a fourth round");
  assert.deepEqual(states, [], "still linking");
  fake.expire();
  await until(() => states.length === 1, "gave up");
  assert.match(states[0] ?? "", /^error:.*press Link/);
  await adapter.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the owner talks in 'Message yourself'; the answer comes back there once, its echo never starts a turn", async () => {
  const calls = llm.calls.length;
  wa.fromOwner("what is on today?");
  await until(() => wa.textsTo(wa.owner).some((t) => t.includes("Got it: what is on today?")), "the answer");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(llm.calls.length - calls, 1, "one turn: the echo of the answer is not the owner writing");
  const home = await env.client.call("threads.get", { thread: "home" });
  assert.ok(home.messages.some((m) => m.parts.some((p) => p.type === "text" && p.text === "what is on today?")));
});

test("a stranger gets nothing from the owner's number; approved, they get answers", async () => {
  const calls = llm.calls.length;
  wa.message(ANA, "hi, is this Ana's friend?");
  await until(async () => (await env.client.call("pairing.list", {})).requests.some((r) => r.name === "Ana"), "listed");
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(wa.textsTo(ANA.phone), [], "no code, no answer");
  assert.equal(llm.calls.length, calls);
  const { notifications } = await env.client.call("notifications.list", {});
  assert.ok(!notifications.some((n) => n.title === "Ana"), "the owner's friends writing are not notices");

  const code = (await env.client.call("pairing.list", {})).requests.find((r) => r.name === "Ana")?.code ?? "";
  await env.client.call("pairing.respond", { code, decision: "contact" });
  wa.message(ANA, "are you there?");
  // A contact's words reach the agent marked as untrusted; the scripted answer repeats them.
  await until(
    () => wa.textsTo(ANA.phone).some((t) => t.startsWith("Got it:") && t.includes("are you there?")),
    "the contact's answer",
  );
});

test("someone under their private id is the same person as their number", async () => {
  wa.message(BOB, "hello");
  await until(async () => (await env.client.call("pairing.list", {})).requests.some((r) => r.name === "Bob"), "listed");
  const req = (await env.client.call("pairing.list", {})).requests.find((r) => r.name === "Bob");
  assert.equal(req?.external_id, BOB.phone);
});

test("groups, and the owner writing to a friend on their phone, never reach the agent", async () => {
  const calls = llm.calls.length;
  wa.message(ANA, "group news", { group: "120363000000000001@g.us" });
  wa.ownerTo(ANA, "see you tonight");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(llm.calls.length, calls);
});

test("logged out from the phone: the channel says so and keeps no dead credentials", async () => {
  wa.logOut();
  await until(async () => (await channel())?.status === "error", "the error");
  assert.match((await channel())?.error ?? "", /link it again/);
  assert.ok(!fs.existsSync(wa.dir));
});

test("removing the channel unlinks the device and drops its folder", async () => {
  await env.client.call("channels.set", {
    id: "whatsapp",
    channel: { type: "whatsapp", agent_id: "roby", self_owner: true },
  });
  await until(async () => Boolean((await channel())?.qr), "a new QR");
  wa.scan();
  await until(async () => (await channel())?.status === "running", "linked again");
  await env.client.call("channels.set", { id: "whatsapp", channel: null });
  assert.equal(wa.loggedOut.value, true);
  assert.ok(!fs.existsSync(wa.dir));
  assert.equal(await channel(), undefined);
});

test("adapter: options go out numbered, a number back presses that option; Markdown reads as WhatsApp", async () => {
  const fake = fakeWhatsApp();
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/apx-wa-`);
  const adapter = whatsappAdapter({ dir, selfOwner: true, lib: async () => fake.lib });
  const actions: string[] = [];
  const ac = new AbortController();
  const io: AdapterIO = {
    receive: () => {},
    action: (a) => actions.push(a.data),
    status: () => {},
    signal: ac.signal,
  };
  let linked = false;
  io.identified = () => {
    linked = true;
  };
  io.qr = (code) => code && fake.scan();
  await adapter.start(io);
  await until(() => linked, "linked");
  await adapter.send(fake.owner, {
    text: "**Allow** the shell?",
    buttons: [
      { id: "in:1:approve", label: "Allow" },
      { id: "in:1:deny", label: "Deny" },
    ],
  });
  assert.equal(fake.textsTo(fake.owner)[0], "*Allow* the shell?\n\n*1* — Allow\n*2* — Deny");
  fake.fromOwner("2");
  await until(() => actions.length === 1, "the option");
  assert.deepEqual(actions, ["in:1:deny"]);
  assert.equal(toWhatsApp("# Title\n[docs](https://example.com) ~~old~~"), "*Title*\ndocs (https://example.com) ~old~");
  await adapter.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});
