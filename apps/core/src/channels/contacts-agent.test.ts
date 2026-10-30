import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-contacts-agent";
const OWNER = { id: 1001, name: "Owner" };
const CONTACT = { id: 2002, name: "Contact" };

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
  return { ...env, tg, llm, helper: helper.id };
}

test("a channel's contacts are answered by their own agent; without one, by the channel's", async (t) => {
  const env = await setup(t);
  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "superagent", contacts_agent_id: env.helper, owner_thread: "own" },
    token: TOKEN,
  });
  const listed = (await env.client.call("channels.list", {})).channels.find((c) => c.id === "tg");
  assert.equal(listed?.contacts_agent_id, env.helper, "the setting is kept");

  env.tg.message(CONTACT, "hello");
  env.tg.message(OWNER, "hello from the owner");
  await waitFor(
    () => env.core.store.threads.byConversation("tg", String(CONTACT.id)) && env.llm.calls.length >= 2,
    "both chats answered",
    { ms: 8000 },
  );
  assert.deepEqual(env.core.store.threads.byConversation("tg", String(CONTACT.id))?.agent_ids, [env.helper]);
  assert.deepEqual(env.core.store.threads.byConversation("tg", String(OWNER.id))?.agent_ids, ["superagent"]);

  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "superagent", owner_thread: "own" },
    token: TOKEN,
  });
  const cleared = (await env.client.call("channels.list", {})).channels.find((c) => c.id === "tg");
  assert.equal(cleared?.contacts_agent_id, undefined, "saved without it, the channel's agent answers contacts again");
});

test("a contacts agent that does not exist is refused", async (t) => {
  const env = await setup(t);
  await assert.rejects(
    env.client.call("channels.set", {
      id: "tg",
      channel: { type: "telegram", agent_id: "superagent", contacts_agent_id: "nobody" },
      token: TOKEN,
    }),
    /agent nobody/,
  );
});
