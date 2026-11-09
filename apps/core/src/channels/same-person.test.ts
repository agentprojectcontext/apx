import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Part } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { joinSplitContacts } from "./same-person.ts";
import type { ChannelAdapter } from "./types.ts";
import { whatsappAdapter } from "./whatsapp.ts";

const DANA = { phone: "5491100000005@s.whatsapp.net", name: "Dana", lid: "200000000000005@lid" };
const EVE = { phone: "5491100000006@s.whatsapp.net", name: "Eve", lid: "200000000000006@lid" };
const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
let wa: ReturnType<typeof fakeWhatsApp>;

before(async () => {
  wa = fakeWhatsApp();
  env = await startCore({
    llm,
    channelAdapters: { whatsapp: () => whatsappAdapter({ dir: `${env.home}/wa`, lib: async () => wa.lib }) },
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const text = (t: string): Part[] => [{ type: "text", text: t }];

test("someone split in two by their private id is one contact and one chat once the line connects", async () => {
  const { store } = env.core;
  // APX wrote to her number first; her reply came under her private id alone and made a stranger of her.
  const known = store.persons.create({ name: "Dana", role: "contact", note: "Met at the fair" });
  store.persons.link(known.id, { channel: "whatsapp", external_id: DANA.phone });
  const stranger = store.persons.create({ name: "Dana", role: "contact", unreviewed: true });
  store.persons.link(stranger.id, { channel: "whatsapp", external_id: DANA.lid });
  const chat = (conversation: string, person_id: string) =>
    store.threads.create({
      kind: "channel",
      title: "Dana",
      agent_ids: ["superagent"],
      channel: { id: "whatsapp", conversation, person_id },
    });
  const byNumber = chat(DANA.phone, known.id);
  const byId = chat(DANA.lid, stranger.id);
  const her = { kind: "person" as const, id: known.id, name: "Dana", channel: "whatsapp" };
  store.messages.add({
    thread_id: byNumber.id,
    author: { kind: "agent", id: "superagent" },
    parts: text("Hi Dana"),
    at: "2026-01-01T10:00:00.000Z",
  });
  const reply = store.messages.add({
    thread_id: byId.id,
    author: { ...her, id: stranger.id },
    parts: text("Hi! Who is this?"),
    at: "2026-01-01T11:00:00.000Z",
  });
  store.channels.inbox.add("whatsapp", {
    external_id: "WA-REPLY",
    ref: "WA-REPLY",
    conversation: DANA.lid,
    sender: { id: DANA.lid, name: "Dana" },
    text: "Hi! Who is this?",
    private: true,
  });
  store.threads.mergeContext(byId.id, {
    their_last: { channel: "whatsapp", conversation: DANA.lid, ref: "WA-REPLY", message_id: reply.id },
  });
  store.messages.add({
    thread_id: byNumber.id,
    author: her,
    parts: text("Got it, thanks"),
    at: "2026-01-01T12:00:00.000Z",
  });
  // Someone known only under their private id goes on under their number, chat included.
  const eve = store.persons.create({ name: "Eve", role: "contact" });
  store.persons.link(eve.id, { channel: "whatsapp", external_id: EVE.lid });
  const eveChat = chat(EVE.lid, eve.id);
  wa.knows(DANA);
  wa.knows(EVE);

  await env.client.call("channels.set", { id: "whatsapp", channel: { type: "whatsapp", agent_id: "superagent" } });
  await waitFor(async () => Boolean((await env.client.call("channels.list", {})).channels[0]?.qr), "a QR");
  wa.scan();
  await waitFor(() => !store.persons.get(stranger.id), "joined");

  const dana = store.persons.get(known.id);
  assert.equal(dana?.note, "Met at the fair");
  assert.equal(dana?.unreviewed, false, "the owner's contact stays as they left it");
  assert.deepEqual(dana?.addresses.map((a) => a.external_id).sort(), [DANA.lid, DANA.phone].sort());
  assert.equal(store.threads.byConversation("whatsapp", DANA.lid), undefined, "one chat");
  assert.deepEqual(
    store.persons
      .get(eve.id)
      ?.addresses.map((a) => a.external_id)
      .sort(),
    [EVE.lid, EVE.phone].sort(),
  );
  assert.equal(store.threads.byConversation("whatsapp", EVE.phone)?.id, eveChat.id);
  // A reaction asked for now goes on what she said last, found under her number.
  assert.equal(store.channels.inbox.latest("whatsapp", DANA.phone)?.ref, "WA-REPLY");
  assert.equal(store.threads.context(byNumber.id).their_last?.conversation, DANA.phone);
  assert.equal(store.threads.context(byNumber.id).their_last?.message_id, reply.id);
  const history = store.messages.list(byNumber.id);
  assert.ok(
    history.every((m) => m.author.kind !== "person" || m.author.id === known.id),
    "her words are signed by the one contact she is",
  );
  assert.deepEqual(
    history.map((m) => [m.seq, m.parts[0]?.type === "text" ? m.parts[0].text : ""]),
    [
      [1, "Hi Dana"],
      [2, "Hi! Who is this?"],
      [3, "Got it, thanks"],
    ],
    "in the order it was said",
  );
});

test("contacts already joined count as nothing done the next time the line connects", async () => {
  const line = {
    sameAs: async () => [
      { from: DANA.lid, to: DANA.phone },
      { from: EVE.lid, to: EVE.phone },
    ],
  } as unknown as ChannelAdapter;
  assert.equal(await joinSplitContacts(env.core.store, "whatsapp", line), 0);
});
