// Numbers saved the local way, without their country code: WhatsApp takes a message for one and drops it, so APX fills
// the code in from the owner's own number, or refuses and says why; it never reports such a message as sent.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "./whatsapp.ts";

// The owner's own line is Peruvian: a number with no country code is read as one from Peru.
const OWNER = "51987000001@s.whatsapp.net";
const llm = scriptedLlm((_req, { said }) => say(`Got it: ${said}`));
let env: Awaited<ReturnType<typeof startCore>>;
let wa: ReturnType<typeof fakeWhatsApp>;

before(async () => {
  wa = fakeWhatsApp(OWNER);
  env = await startCore({
    llm,
    channelAdapters: {
      whatsapp: (c) =>
        whatsappAdapter({ dir: `${env.home}/wa`, selfOwner: c.self_owner === true, lib: async () => wa.lib }),
    },
  });
  await env.client.call("channels.set", {
    id: "whatsapp",
    channel: { type: "whatsapp", agent_id: "superagent", self_owner: true },
  });
  const status = async () =>
    (await env.client.call("channels.list", {})).channels.find((c) => c.id === "whatsapp")?.status;
  await waitFor(async () => (await env.client.call("channels.list", {})).channels.some((c) => c.qr), "a QR");
  wa.scan();
  await waitFor(async () => (await status()) === "running", "linked");
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const contact = async (name: string) => (await env.client.call("contacts.set", { name })).id;
const message = (person: string, text: string) =>
  env.client.call("channels.message", { person, text, channel: "whatsapp" });

test("a number saved without its country code is kept with the owner's, and the message reaches it", async () => {
  const debtor = await contact("Debtor One");
  const p = await env.client.call("contacts.address", { channel: "whatsapp", address: "976 666 004", person: debtor });
  assert.deepEqual(
    p.addresses.map((a) => a.external_id),
    ["51976666004@s.whatsapp.net"],
  );
  // Saved again already international, it stays as it is.
  const again = await env.client.call("contacts.address", {
    channel: "whatsapp",
    address: "+51 976 666 004",
    person: debtor,
  });
  assert.deepEqual(
    again.addresses.map((a) => a.external_id),
    ["51976666004@s.whatsapp.net"],
  );
  const r = await message(debtor, "Your invoice is due");
  assert.ok("delivery" in r);
  assert.equal(r.delivery.state, "sent");
  assert.deepEqual(wa.textsTo("51976666004@s.whatsapp.net"), ["Your invoice is due"]);
  assert.ok(wa.checked.includes("51976666004@s.whatsapp.net"), "WhatsApp was asked whether the number has it");
});

test("what is not a phone number is refused when saved, saying why", async () => {
  const someone = await contact("Someone");
  await assert.rejects(
    env.client.call("contacts.address", { channel: "whatsapp", address: "call me", person: someone }),
    /"call me" is not a phone number/,
  );
  await assert.rejects(
    env.client.call("contacts.address", { channel: "whatsapp", address: "+976 666 004", person: someone }),
    /not a valid phone number: check its digits/,
  );
});

test("a number nobody has WhatsApp on is not sent, and the send says so", async () => {
  const gone = await contact("Debtor Two");
  await env.client.call("contacts.address", { channel: "whatsapp", address: "976 666 005", person: gone });
  wa.absent.add("51976666005");
  const r = await message(gone, "Your invoice is due");
  assert.ok("delivery" in r);
  assert.equal(r.delivery.state, "failed");
  assert.match(r.delivery.error ?? "", /\+51976666005 is not on WhatsApp/);
  assert.deepEqual(wa.textsTo("51976666005@s.whatsapp.net"), [], "nothing went out");
  assert.deepEqual(wa.textsTo("976666005@s.whatsapp.net"), []);
});

test("a contact saved before, without the country code, is written at the full number and answers in the same chat", async () => {
  const old = await contact("Debtor Three");
  // As an earlier version kept it: the digits as typed.
  env.core.store.persons.link(old, { channel: "whatsapp", external_id: "976666006@s.whatsapp.net", label: "Debtor" });
  const r = await message(old, "Reminder: your invoice is due");
  assert.ok("delivery" in r);
  assert.equal(r.delivery.state, "sent");
  assert.deepEqual(wa.textsTo("51976666006@s.whatsapp.net"), ["Reminder: your invoice is due"]);
  assert.deepEqual(wa.textsTo("976666006@s.whatsapp.net"), [], "never to the number without its code");
  const fixed = env.core.store.persons.get(old)?.addresses.map((a) => a.external_id);
  assert.deepEqual(fixed, ["51976666006@s.whatsapp.net"], "the contact now has the full number");
  const thread = env.core.store.threads.byConversation("whatsapp", "51976666006@s.whatsapp.net");
  assert.equal(thread?.id, r.thread, "their chat moved with it");

  // Their answer comes from the full number: it is them, in that chat, not a stranger asking to be let in.
  wa.message({ phone: "51976666006@s.whatsapp.net", name: "Debtor Three" }, "paid it this morning");
  await waitFor(
    () => wa.textsTo("51976666006@s.whatsapp.net").some((t) => t.includes("paid it this morning")),
    "the agent answers them",
  );
  const { requests } = await env.client.call("pairing.list", {});
  assert.ok(!requests.some((q) => q.name === "Debtor Three"), "no pairing request");
  const messages = (await env.client.call("threads.get", { thread: r.thread })).messages;
  assert.ok(messages.some((m) => JSON.stringify(m).includes("paid it this morning")));
});
