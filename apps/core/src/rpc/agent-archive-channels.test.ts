import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("an agent that answers a channel is not archived until another one answers it", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  t.after(async () => {
    await env.core.close();
    await env.cleanup();
  });
  const { project } = await env.client.call("projects.create", { name: "Acme" });
  const head = await env.client.call("agents.create", { project_id: project.id, slug: "acme-head", name: "Head" });
  const base = { type: "telegram", enabled: false, strangers: "pair", concurrency: "steer" } as const;
  env.core.store.settings.write("channels", [
    {
      ...base,
      id: "telegram",
      label: "Sales",
      agent_id: "superagent",
      contacts_agent_id: head.id,
      owner_thread: "home",
    },
  ]);
  await assert.rejects(env.client.call("agents.archive", { agent: head.id }), /Head answers Sales/);
  assert.ok(env.core.store.agents.active(head.id), "it stays");

  env.core.store.settings.write("channels", [
    { ...base, id: "telegram", label: "Sales", agent_id: "superagent", owner_thread: "home" },
  ]);
  await env.client.call("agents.archive", { agent: head.id });
  assert.equal(env.core.store.agents.active(head.id), false);
  await assert.rejects(
    env.client.call("channels.set", {
      id: "telegram",
      channel: { type: "telegram", enabled: false, agent_id: "superagent", contacts_agent_id: head.id },
      token: "123456:TEST-archived",
    }),
    /agent/,
    "a channel cannot be handed to an archived agent",
  );
});
