import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("jobs.list names what each queued turn carries, never its text", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Audit" })).id;
    const deadline_at = new Date(Date.now() + 60_000).toISOString();
    // `queued` runs are never picked up by the engine: they stay in the list as they are.
    const result = env.core.store.runs.create({
      thread_id: thread,
      agent_id: "roby",
      trigger: "a2a_result",
      state: "queued",
      deadline_at,
      input: {
        text: "Part checked.",
        origin: {
          kind: "delegation_result",
          agent_id: "scout",
          name: "Scout",
          thread_id: thread,
          run_id: "run_x",
          state: "completed",
        },
      },
    });
    const owner = env.core.store.runs.create({
      thread_id: thread,
      agent_id: "roby",
      trigger: "user",
      state: "queued",
      deadline_at,
      input: { text: "And the totals?", origin: { kind: "user" } },
    });
    const { running } = await env.client.call("jobs.list", { finished: 5 });
    const byId = new Map(running.map((j) => [j.id, j]));
    assert.deepEqual(byId.get(result.id)?.from, { kind: "delegation_result", name: "Scout" });
    assert.deepEqual(byId.get(owner.id)?.from, { kind: "user" });
    assert.ok(!JSON.stringify(running).includes("Part checked."));
  } finally {
    await env.core.close();
    env.cleanup();
  }
});
