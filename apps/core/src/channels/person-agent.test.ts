import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-person-agent";
const OWNER = { id: 1001, name: "Owner" };
const CONTACT = { id: 2002, name: "Contact" };
const TG = { type: "telegram", agent_id: "superagent", owner_thread: "own" } as const;

async function setup(t: TestContext) {
  const tg = await fakeTelegram(TOKEN);
  const llm = scriptedLlm(() => say("Noted"));
  const env = await startCore({ llm, channelAdapters: { telegram: (c, token) => telegramAdapter(c, token, tg.url) } });
  t.after(async () => {
    await env.core.close();
    await tg.close();
    await env.cleanup();
  });
  const helper = await env.client.call("agents.create", { slug: "northwind-helper", name: "Helper", role: "helper" });
  env.core.store.persons.link(env.core.store.persons.owner().id, { channel: "tg", external_id: String(OWNER.id) });
  const contact = env.core.store.persons.create({ name: CONTACT.name, role: "contact" });
  env.core.store.persons.link(contact.id, { channel: "tg", external_id: String(CONTACT.id) });
  await env.client.call("channels.set", { id: "tg", channel: TG, token: TOKEN });
  return { ...env, tg, llm, helper: helper.id, contact: contact.id };
}

const chatOf = (env: Awaited<ReturnType<typeof setup>>) =>
  env.core.store.threads.byConversation("tg", String(CONTACT.id));

test("a contact given an agent of their own is answered by it, not by the account's", async (t) => {
  const env = await setup(t);
  const saved = await env.client.call("contacts.set", { id: env.contact, name: CONTACT.name, agent_id: env.helper });
  assert.equal(saved.agent_id, env.helper, "the setting is kept");

  env.tg.message(CONTACT, "hello");
  await waitFor(() => chatOf(env) && env.llm.calls.length >= 1, "the contact's chat answered", { ms: 8000 });
  assert.deepEqual(chatOf(env)?.agent_ids, [env.helper]);
});

test("a contact's open chat follows their own agent, and goes back to the account's when it is taken away", async (t) => {
  const env = await setup(t);
  env.tg.message(CONTACT, "hello before the change");
  await waitFor(() => chatOf(env), "the contact's chat", { ms: 8000 });
  assert.equal(chatOf(env)?.agent_ids[0], "superagent");

  await env.client.call("contacts.set", { id: env.contact, name: CONTACT.name, agent_id: env.helper });
  assert.equal(chatOf(env)?.agent_ids[0], env.helper);

  await env.client.call("contacts.set", { id: env.contact, name: CONTACT.name, agent_id: null });
  assert.equal(chatOf(env)?.agent_ids[0], "superagent");
  assert.equal(env.core.store.persons.get(env.contact)?.agent_id, undefined);
});

test("changing the account's contacts agent leaves a contact who has their own", async (t) => {
  const env = await setup(t);
  env.tg.message(CONTACT, "hello");
  await waitFor(() => chatOf(env), "the contact's chat", { ms: 8000 });
  await env.client.call("contacts.set", { id: env.contact, name: CONTACT.name, agent_id: env.helper });
  const desk = await env.client.call("agents.create", { slug: "northwind-desk", name: "Desk", role: "desk" });

  // The account's contacts agent goes from the helper (none set: the super-agent) to Desk: the contact keeps theirs.
  await env.client.call("channels.set", { id: "tg", channel: { ...TG, contacts_agent_id: desk.id }, token: TOKEN });
  assert.equal(chatOf(env)?.agent_ids[0], env.helper);
});

test("an agent that does not exist, or one for the owner, is refused", async (t) => {
  const env = await setup(t);
  await assert.rejects(
    env.client.call("contacts.set", { id: env.contact, name: CONTACT.name, agent_id: "nobody" }),
    /agent nobody/,
  );
  const owner = env.core.store.persons.owner();
  await assert.rejects(
    env.client.call("contacts.set", { id: owner.id, name: owner.name, agent_id: env.helper }),
    /owner/,
  );
});

test("an account with its notices silenced tells the owner nothing about a stranger; failures aside", async (t) => {
  const env = await setup(t);
  const tray = async () => (await env.client.call("notifications.list", {})).notifications;
  await env.client.call("channels.set", { id: "tg", channel: { ...TG, quiet: true }, token: TOKEN });
  const listed = (await env.client.call("channels.list", {})).channels.find((c) => c.id === "tg");
  assert.equal(listed?.quiet, true, "the setting is kept");

  const quiet = { id: 3003, name: "Quiet stranger" };
  env.tg.message(quiet, "hi");
  await waitFor(() => env.tg.messagesTo(quiet.id).length === 1, "the stranger still gets a code", { ms: 8000 });
  assert.ok(!(await tray()).some((n) => n.title.startsWith(quiet.name)), "nothing in the tray");
  assert.equal(env.tg.messagesTo(OWNER.id).length, 0, "nothing on the owner's chat app");

  await env.client.call("channels.set", { id: "tg", channel: TG, token: TOKEN });
  const heard = { id: 4004, name: "Heard stranger" };
  env.tg.message(heard, "hi");
  await waitFor(
    async () => (await tray()).some((n) => n.title.startsWith(heard.name)),
    "heard again once it is back on",
    {
      ms: 8000,
    },
  );
});
