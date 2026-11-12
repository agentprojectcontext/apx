// The people who write in a channel account's rooms are its contacts to manage: listed without being approved,
// kept as unreviewed contacts when the owner gives them a relation, and any of their addresses marked as the owner's.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { OWNER_ID } from "../domain/persons.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { discordAdapter } from "./discord.ts";
import { fakeDiscord } from "./fake-discord.test-support.ts";

const TOKEN = "MTIzNDU2.fake.discord-token-contacts";
const OWNER = { id: "111", name: "Owner" };
const ANA = { id: "222", name: "Ana" };
const BEN = { id: "333", name: "Ben" };
const CARL = { id: "444", name: "Carl" };
const HELPER = { id: "999", name: "Helper bot" };
const GENERAL = "8001";
const HELP = "8002";

const llm = scriptedLlm((_req, { said }) => say(`Reply: ${said.split("\n").at(-1)?.slice(0, 60)}`));
let env: Awaited<ReturnType<typeof startCore>>;
let dc: Awaited<ReturnType<typeof fakeDiscord>>;

const roomMessages = (room: string) => {
  const t = env.core.store.threads.byConversation("dc", room);
  return t ? env.core.store.messages.list(t.id) : [];
};
const seen = async () => (await env.client.call("contacts.seen", { channel: "dc" })).seen;

before(async () => {
  dc = await fakeDiscord(TOKEN);
  env = await startCore({ llm, channelAdapters: { discord: (c, t) => discordAdapter(c, t, dc.urls) } });
  env.core.store.persons.owner();
  env.core.store.persons.link(OWNER_ID, { channel: "dc", external_id: OWNER.id, label: "Discord" });
  await env.client.call("channels.set", {
    id: "dc",
    channel: {
      type: "discord",
      agent_id: "superagent",
      rooms: {
        rooms: [
          { id: GENERAL, name: "general", mode: "read" },
          { id: HELP, name: "help", mode: "read" },
        ],
        names: ["roby"],
      },
    },
    token: TOKEN,
  });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
  dc.message(ANA, "hello all", { room: GENERAL });
  dc.message(BEN, "how do I install it?", { room: HELP });
  dc.message(ANA, "same question", { room: HELP });
  dc.message(HELPER, "I am a bot", { room: GENERAL, bot: true });
  dc.message(CARL, "hi", { room: GENERAL });
  await waitFor(() => roomMessages(GENERAL).length + roomMessages(HELP).length === 4, "the room messages kept");
});
after(async () => {
  await env.core.close();
  await dc.close();
  await env.cleanup();
});

test("whoever wrote in the rooms is listed, newest first, with how often and where; no bot, nobody approved", async () => {
  const before = env.core.store.persons.list().length;
  const list = await seen();
  assert.deepEqual(list.map((s) => [s.address, s.name, s.messages]).sort(), [
    [ANA.id, "@ana", 2],
    [BEN.id, "@ben", 1],
    [CARL.id, "@carl", 1],
  ]);
  // Newest first by when each message was kept: two rooms may keep theirs in either order.
  const times = list.map((s) => s.last_at);
  assert.deepEqual(times, [...times].sort().reverse());
  // Where they last wrote is a room with their latest message in it.
  const ana = list.find((s) => s.address === ANA.id);
  const last = [...roomMessages(GENERAL), ...roomMessages(HELP)].filter(
    (m) => m.author.kind === "person" && m.author.id === `discord:${ANA.id}` && m.created_at === ana?.last_at,
  );
  assert.ok(last.some((m) => m.thread_id === ana?.thread_id));
  assert.ok(list.every((s) => !s.person_id));
  // Listing someone makes nobody a person, so nobody is answered or approved for it.
  assert.equal(env.core.store.persons.list().length, before);
  await assert.rejects(env.client.call("contacts.seen", { channel: "nowhere" }), /not found/i);
});

test("given a relation from the list, a room speaker is an unreviewed contact: a private message is kept, not answered", async () => {
  const ana = await env.client.call("contacts.keep", {
    channel: "dc",
    address: ANA.id,
    as: "contact",
    relation: "client",
  });
  assert.equal(ana.name, "@ana");
  assert.equal(ana.relation, "client");
  assert.equal(ana.unreviewed, true);
  assert.equal(ana.muted, true);
  assert.deepEqual(
    ana.addresses.map((a) => [a.channel, a.external_id]),
    [["dc", ANA.id]],
  );
  // Their earlier room messages still count as theirs.
  assert.equal((await seen()).find((s) => s.address === ANA.id)?.person_id, ana.id);
  // A relation set later from the list keeps them unreviewed.
  const later = await env.client.call("contacts.set", { id: ana.id, name: ana.name, relation: "friend" });
  assert.equal(later.unreviewed, true);

  dc.message(ANA, "can you help me in private?");
  await waitFor(() => {
    const t = env.core.store.threads.byConversation("dc", dc.dm(ANA.id));
    return Boolean(t && env.core.store.messages.list(t.id).length);
  }, "their private message kept");
  assert.equal(dc.messagesTo(dc.dm(ANA.id)).length, 0, "no answer and no pairing code");

  await assert.rejects(
    env.client.call("contacts.keep", { channel: "dc", address: ANA.id, as: "contact" }),
    /already @ana/,
  );
  await assert.rejects(
    env.client.call("contacts.keep", { channel: "dc", address: "555", as: "owner" }),
    /nobody wrote/,
  );
});

test("the owner marks a room speaker's address as theirs and unmarks it: it goes back to an unreviewed contact", async () => {
  const owner = await env.client.call("contacts.keep", { channel: "dc", address: BEN.id, as: "owner" });
  assert.equal(owner.id, OWNER_ID);
  assert.deepEqual(owner.addresses.map((a) => a.external_id).sort(), [OWNER.id, BEN.id].sort());
  assert.equal((await seen()).find((s) => s.address === BEN.id)?.person_id, OWNER_ID);

  // Their words in a room are the owner's now.
  dc.message(BEN, "this is me speaking", { room: GENERAL });
  await waitFor(() => roomMessages(GENERAL).some((m) => m.author.kind === "user"), "kept as the owner's");

  const address = owner.addresses.find((a) => a.external_id === BEN.id)?.id ?? "";
  const ben = await env.client.call("contacts.unclaim", { address });
  assert.equal(ben.name, "@ben");
  assert.equal(ben.role, "contact");
  assert.equal(ben.unreviewed, true);
  assert.deepEqual(
    env.core.store.persons.get(OWNER_ID)?.addresses.map((a) => a.external_id),
    [OWNER.id],
  );
  await assert.rejects(env.client.call("contacts.unclaim", { address }), /not found/i);
});

test("marking a contact's address as the owner's still goes through the claim, and back again", async () => {
  const carl = await env.client.call("contacts.keep", { channel: "dc", address: CARL.id, as: "contact" });
  const address = carl.addresses[0]?.id ?? "";
  assert.deepEqual(await env.client.call("contacts.claim", { address }), { moved: true });
  // Left with no address, the contact is gone: the address is the owner's.
  assert.equal(env.core.store.persons.get(carl.id), undefined);
  const back = await env.client.call("contacts.unclaim", { address });
  // Named as they signed in the room.
  assert.equal(back.name, "@carl");
  assert.equal(env.core.store.persons.byAddress("dc", CARL.id)?.id, back.id);
});
