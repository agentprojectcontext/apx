import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Part } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
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
  store.messages.add({
    thread_id: byId.id,
    author: her,
    parts: text("Hi! Who is this?"),
    at: "2026-01-01T11:00:00.000Z",
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
  const history = store.messages.list(byNumber.id);
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
