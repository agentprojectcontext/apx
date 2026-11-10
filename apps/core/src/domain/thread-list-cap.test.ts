import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("a contact's older chat stays listed when newer chats fill the cap", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const { store } = env.core;
    const person = await env.client.call("contacts.set", { name: "Northwind Buyer" });
    const contact = store.threads.create({
      kind: "channel",
      title: person.name,
      agent_ids: ["superagent"],
      channel: { id: "whatsapp", conversation: person.id, person_id: person.id },
      at: "2026-01-01T00:00:00.000Z",
    });
    for (const [i, title] of ["One", "Two", "Three"].entries())
      store.threads.create({ kind: "loose", title, agent_ids: ["superagent"], at: `2026-02-0${i + 1}T00:00:00.000Z` });

    const listed = store.threads.list({ limit: 3 }).map((t) => t.title);
    // Home is the newest chat of a fresh core.
    assert.deepEqual(listed.slice(0, 3), ["Home", "Three", "Two"], "the cap still keeps the newest");
    assert.ok(listed.includes(contact.title), "the contact's chat is not dropped");
    assert.equal(listed.length, 4);
    assert.equal(store.threads.list({ limit: 1 }).length, 1, "a single latest chat stays one");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
