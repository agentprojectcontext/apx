import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const base = { type: "telegram", enabled: true, strangers: "pair", concurrency: "steer" } as const;

test("a message to a contact goes out from an account its sender answers; when several could, it is refused", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  t.after(async () => {
    await env.core.close();
    await env.cleanup();
  });
  const head = async (name: string) => {
    const { project } = await env.client.call("projects.create", { name: `Acme ${name}` });
    return (await env.client.call("agents.create", { project_id: project.id, slug: `${name}-head`, name })).id;
  };
  const sales = await head("sales");
  const support = await head("support");
  const { store } = env.core;
  store.settings.write("channels", [
    { ...base, id: "telegram", label: "Personal", agent_id: "superagent", owner_thread: "home" },
    {
      ...base,
      id: "telegram-s1",
      label: "Sales",
      agent_id: "superagent",
      contacts_agent_id: sales,
      owner_thread: "home",
    },
    { ...base, id: "telegram-s2", label: "Support", agent_id: support, owner_thread: "own" },
  ]);
  const buyer = store.persons.create({ name: "Acme Buyer", role: "contact" });
  for (const channel of ["telegram-s1", "telegram"]) store.persons.link(buyer.id, { channel, external_id: "41" });
  // The personal account has the newest chat with them.
  store.threads.create({
    kind: "channel",
    title: buyer.name,
    agent_ids: ["superagent"],
    channel: { id: "telegram", conversation: "41", person_id: buyer.id },
  });
  const from = (o: { by?: string; channel?: string }, person = buyer.id) => {
    const sent = env.core.channels.messageContact(person, "Your quote is ready", o);
    return store.channels.outbox.get(sent.outbox)?.channel;
  };

  assert.equal(from({ by: sales, channel: "telegram" }), "telegram-s1", "the sales head writes from the sales account");
  assert.equal(from({ by: "superagent", channel: "telegram" }), "telegram", "the super-agent, from the owner's own");
  assert.equal(from({ channel: "telegram" }), "telegram", "the owner, from their own");

  const client = store.persons.create({ name: "Northwind Client", role: "contact" });
  for (const channel of ["telegram-s1", "telegram-s2"]) store.persons.link(client.id, { channel, external_id: "52" });
  assert.equal(from({ by: support }, client.id), "telegram-s2");
  assert.throws(
    () => from({ by: "superagent", channel: "telegram" }, client.id),
    /Northwind Client is on several accounts: Sales \(telegram-s1\), Support \(telegram-s2\)/,
    "nobody's own account: it asks which instead of guessing",
  );
  assert.equal(from({ by: "superagent", channel: "telegram-s2" }, client.id), "telegram-s2", "an account by its id");
});

test("an account's activity lists its own sends, however busy the other accounts are", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  t.after(async () => {
    await env.core.close();
    await env.cleanup();
  });
  const { store } = env.core;
  store.settings.write("channels", [
    { ...base, id: "telegram", label: "Personal", agent_id: "superagent", owner_thread: "home" },
    { ...base, id: "telegram-q1", label: "Quiet", agent_id: "superagent", owner_thread: "home" },
  ]);
  const buyer = store.persons.create({ name: "Acme Buyer", role: "contact" });
  store.persons.link(buyer.id, { channel: "telegram", external_id: "41" });
  store.persons.link(buyer.id, { channel: "telegram-q1", external_id: "42" });
  env.core.channels.messageContact(buyer.id, "From the quiet account", { channel: "telegram-q1" });
  for (const n of [1, 2, 3])
    env.core.channels.messageContact(buyer.id, `Busy ${n}`, { channel: "telegram", exact: true });
  const quiet = await env.client.call("channels.outbox", { channel: "telegram-q1", limit: 2 });
  assert.deepEqual(
    quiet.items.map((o) => [o.channel, o.text]),
    [["telegram-q1", "From the quiet account"]],
  );
  const all = await env.client.call("channels.outbox", { limit: 2 });
  assert.equal(all.items.length, 2);
  assert.ok(
    all.items.every((o) => o.channel === "telegram"),
    "without a channel, the newest of every account",
  );
});
