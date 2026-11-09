import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { AdapterFactory, AdapterIO } from "../channels/types.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";

/** Accounts that connect only when the test says so (a QR scanned, a bot reached). */
function accounts() {
  const io = new Map<string, AdapterIO>();
  const factory: AdapterFactory = (config) => ({
    caps: { typing: false, buttons: false },
    async start(i) {
      io.set(config.id, i);
      return { waiting: true };
    },
    async stop() {},
    async send() {
      return {};
    },
  });
  return { factory, connect: (id: string) => io.get(id)?.status("running") };
}

async function core(t: TestContext, home?: string) {
  const fake = accounts();
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    channelAdapters: { whatsapp: fake.factory, ntfy: fake.factory, imessage: fake.factory, email: fake.factory },
    ...(home ? { home } : {}),
  });
  let open = true;
  const close = async () => {
    if (open) await env.core.close();
    open = false;
  };
  t.after(async () => {
    await close();
    if (!home) await env.cleanup();
  });
  return { ...env, ...fake, close };
}

test("the core names a new account and gives it what every account starts with", async (t) => {
  const env = await core(t);
  const first = await env.client.call("channels.add", { type: "whatsapp", self_owner: false });
  const second = await env.client.call("channels.add", { type: "whatsapp", label: "Shop", self_owner: false });
  assert.equal(first.id, "whatsapp");
  assert.match(second.id, /^whatsapp-[0-9a-f]{10}$/);
  const made = second.channels.find((c) => c.id === first.id);
  assert.deepEqual(
    [made?.label, made?.agent_id, made?.strangers, made?.concurrency, made?.owner_thread, made?.self_owner],
    ["WhatsApp", "superagent", "pair", "steer", "home", false],
  );
  assert.equal(second.channels.find((c) => c.id === second.id)?.label, "Shop");
  const third = await env.client.call("channels.add", { type: "whatsapp" });
  assert.equal(third.channels.find((c) => c.id === third.id)?.label, "WhatsApp 3");
  const mail = await env.client.call("channels.add", { type: "email", label: "Orders" });
  assert.match(mail.id, /^email-[0-9a-f]{24}$/, "a mailbox always has an id of its own");
  assert.equal(mail.channels.find((c) => c.id === mail.id)?.concurrency, "queue");
});

test("iMessage is one per Mac, whichever way a second one is asked for", async (t) => {
  const env = await core(t);
  const made = await env.client.call("channels.add", { type: "imessage" });
  assert.equal(made.id, "imessage");
  await assert.rejects(env.client.call("channels.add", { type: "imessage" }), /iMessage is one per Mac/);
  await assert.rejects(
    env.client.call("channels.set", { id: "imessage-2", channel: { type: "imessage", agent_id: "superagent" } }),
    /iMessage is one per Mac/,
  );
  await env.client.call("channels.set", { id: "imessage", channel: { type: "imessage", agent_id: "superagent" } });
  assert.equal((await env.client.call("channels.list", {})).channels.filter((c) => c.type === "imessage").length, 1);
});

test("a new account never connected is dropped when the core starts again; a connected one stays", async (t) => {
  const home = tempDir("apx-accounts-");
  const before = await core(t, home.path);
  const kept = await before.client.call("channels.add", { type: "ntfy", token: "topic-acme-orders" });
  const left = await before.client.call("channels.add", { type: "ntfy", token: "topic-acme-left" });
  await waitFor(() => {
    before.connect(kept.id);
    return before.core.channels.info().find((c) => c.id === kept.id)?.status === "running";
  }, "the first account connects");
  await before.close();

  const after = await core(t, home.path);
  const ids = (await after.client.call("channels.list", {})).channels.map((c) => c.id);
  assert.deepEqual(ids, [kept.id], `${left.id} is gone`);
  assert.equal(after.core.secrets.resolve(`secret://channel-${kept.id}`), "topic-acme-orders");
  assert.equal(after.core.secrets.resolve(`secret://channel-${left.id}`), undefined, "with its sign-in");
  await after.close();
  await home.remove();
});

test("a contact is added with their address, or not at all", async (t) => {
  const env = await core(t);
  await env.client.call("channels.add", { type: "whatsapp", self_owner: false });
  await assert.rejects(env.client.call("contacts.add", { channel: "whatsapp", name: "Acme Buyer", address: "abc" }));
  assert.equal(
    env.core.store.persons.list().filter((p) => p.name === "Acme Buyer").length,
    0,
    "a wrong address leaves no contact",
  );
  const p = await env.client.call("contacts.add", { channel: "whatsapp", name: "Acme Buyer", address: "+14155550123" });
  assert.deepEqual(
    p.addresses.map((a) => [a.channel, a.external_id]),
    [["whatsapp", "14155550123@s.whatsapp.net"]],
  );
  await assert.rejects(
    env.client.call("contacts.add", { channel: "whatsapp", name: "Northwind", address: "+14155550123" }),
    /already Acme Buyer/,
    "an address already someone's is not taken from them",
  );
});
