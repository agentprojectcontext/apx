import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
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

test("chats a contact already had move to the contacts agent when it is set; the owner's own chat stays", async (t) => {
  const env = await setup(t);
  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "superagent", owner_thread: "own" },
    token: TOKEN,
  });
  env.tg.message(CONTACT, "hello before the change");
  env.tg.message(OWNER, "owner before the change");
  await waitFor(
    () => env.core.store.threads.byConversation("tg", String(CONTACT.id)) && env.llm.calls.length >= 2,
    "both chats answered",
    { ms: 8000 },
  );
  assert.deepEqual(env.core.store.threads.byConversation("tg", String(CONTACT.id))?.agent_ids, ["superagent"]);

  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "superagent", contacts_agent_id: env.helper, owner_thread: "own" },
    token: TOKEN,
  });
  assert.equal(env.core.store.threads.byConversation("tg", String(CONTACT.id))?.agent_ids[0], env.helper);
  assert.equal(env.core.store.threads.byConversation("tg", String(OWNER.id))?.agent_ids[0], "superagent");
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

test("saving any other setting leaves a contact's chat with the agent the owner handed it to", async (t) => {
  const env = await setup(t);
  const tg = { type: "telegram", agent_id: "superagent", owner_thread: "own" } as const;
  await env.client.call("channels.set", { id: "tg", channel: tg, token: TOKEN });
  env.tg.message(CONTACT, "hello");
  await waitFor(() => env.core.store.threads.byConversation("tg", String(CONTACT.id)), "the contact's chat", {
    ms: 8000,
  });
  const chat = env.core.store.threads.byConversation("tg", String(CONTACT.id));
  assert.ok(chat);
  env.core.store.threads.handOver(chat.id, "superagent", env.helper);

  await env.client.call("channels.set", { id: "tg", channel: { ...tg, strangers: "ignore" }, token: TOKEN });
  assert.equal(env.core.store.threads.get(chat.id)?.agent_ids[0], env.helper, "an unrelated save moves nothing");

  const other = await env.client.call("agents.create", { slug: "northwind-desk", name: "Desk", role: "desk" });
  await env.client.call("channels.set", { id: "tg", channel: { ...tg, contacts_agent_id: other.id }, token: TOKEN });
  assert.equal(env.core.store.threads.get(chat.id)?.agent_ids[0], env.helper, "a chat handed over keeps its agent");
});

test("the owner's own chat follows the agent they talk to, into that agent's project", async (t) => {
  const env = await setup(t);
  const dir = tempDir("apx-head-");
  t.after(() => dir.remove());
  fs.writeFileSync(path.join(dir.path, "AGENTS.md"), "# Acme\n");
  const { project } = await env.client.call("projects.register", { path: dir.path, init: true });
  const head = await env.client.call("agents.create", { project_id: project.id, slug: "acme-head", name: "Head" });
  const tg = { type: "telegram", agent_id: "superagent", owner_thread: "own" } as const;
  await env.client.call("channels.set", { id: "tg", channel: tg, token: TOKEN });
  env.tg.message(CONTACT, "hello");
  env.tg.message(OWNER, "hello from the owner");
  await waitFor(
    () => env.core.store.threads.byConversation("tg", String(OWNER.id)) && env.llm.calls.length >= 2,
    "both chats answered",
    { ms: 8000 },
  );

  await env.client.call("channels.set", {
    id: "tg",
    channel: { ...tg, agent_id: head.id, contacts_agent_id: "superagent" },
    token: TOKEN,
  });
  const own = env.core.store.threads.byConversation("tg", String(OWNER.id));
  assert.deepEqual([own?.agent_ids[0], own?.project_id], [head.id, project.id]);
  const contact = env.core.store.threads.byConversation("tg", String(CONTACT.id));
  assert.deepEqual([contact?.agent_ids[0], contact?.project_id], ["superagent", undefined], "contacts stay");
});

test("Home is the super-agent's: a channel a project's head answers keeps the owner in its own chat", async (t) => {
  const env = await setup(t);
  const dir = tempDir("apx-head-");
  t.after(() => dir.remove());
  fs.writeFileSync(path.join(dir.path, "AGENTS.md"), "# Acme\n");
  const { project } = await env.client.call("projects.register", { path: dir.path, init: true });
  const head = await env.client.call("agents.create", { project_id: project.id, slug: "acme-head", name: "Head" });

  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "superagent", owner_thread: "home" },
    token: TOKEN,
  });
  env.tg.message(OWNER, "to Home");
  await waitFor(
    () =>
      env.core.store.messages.list("home").some((m) => m.parts.some((p) => p.type === "text" && p.text === "to Home")),
    "the super-agent's channel writes into Home",
    { ms: 8000 },
  );

  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: head.id, owner_thread: "home" },
    token: TOKEN,
  });
  const saved = (await env.client.call("channels.list", {})).channels.find((c) => c.id === "tg");
  assert.equal(saved?.owner_thread, "own", "another agent cannot take the owner into Home");
  env.tg.message(OWNER, "to the head");
  await waitFor(() => env.core.store.threads.byConversation("tg", String(OWNER.id)), "the channel's own chat", {
    ms: 8000,
  });
  const own = env.core.store.threads.byConversation("tg", String(OWNER.id));
  assert.deepEqual([own?.agent_ids[0], own?.project_id], [head.id, project.id]);
  await waitFor(
    () =>
      env.core.store.messages
        .list(own?.id ?? "")
        .some((m) => m.parts.some((p) => p.type === "text" && p.text === "to the head")),
    "the owner's words reach the head's chat",
    { ms: 8000 },
  );
  assert.ok(
    !env.core.store.messages
      .list("home")
      .some((m) => m.parts.some((p) => p.type === "text" && p.text === "to the head")),
    "nothing of it lands in Home",
  );
});

test("notices for the owner go out only on an account the super-agent answers", async (t) => {
  const env = await setup(t);
  const dir = tempDir("apx-notice-");
  t.after(() => dir.remove());
  fs.writeFileSync(path.join(dir.path, "AGENTS.md"), "# Acme\n");
  const { project } = await env.client.call("projects.register", { path: dir.path, init: true });
  const head = await env.client.call("agents.create", { project_id: project.id, slug: "acme-head", name: "Head" });
  const sent = () =>
    env.core.store.channels.outbox.recent(50).filter((o) => o.channel === "tg" && o.text === "Routine news").length;

  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: head.id, owner_thread: "own" },
    token: TOKEN,
  });
  assert.equal(env.core.channels.notifyOwner({ text: "Routine news" }), false, "a head's account is not a notice line");
  assert.equal(sent(), 0);

  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "superagent", owner_thread: "home" },
    token: TOKEN,
  });
  assert.equal(env.core.channels.notifyOwner({ text: "Routine news" }), true);
  assert.equal(sent(), 1);
});
