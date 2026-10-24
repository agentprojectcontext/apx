import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("terminal jobs keep their agent and chat visible after the turn ends", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Asset export" });
    const job = env.core.store.jobs.create({
      thread_id: thread.id,
      agent_id: "roby",
      title: "render",
      cwd: ".",
      background: true,
    });
    const agent = env.core.store.agents.get("roby");
    for (const params of [{ finished: 5 }, { thread: thread.id, finished: 5 }]) {
      const list = await env.client.call("jobs.list", params);
      assert.equal(list.running.find((j) => j.id === job.id)?.thread_title, "Asset export");
      assert.equal(list.running.find((j) => j.id === job.id)?.agent_name, agent?.name);
    }
    env.core.store.jobs.finish(job.id, "completed", 0);
    const result = await env.client.call("jobs.get", { job: job.id });
    assert.equal(result.job.thread_title, "Asset export");
    assert.equal(result.job.agent_name, agent?.name);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

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
    await env.cleanup();
  }
});

test("usage.summary of a chat totals every run it kept, not the newest page an app loads", async () => {
  const env = await startCore({
    llm: scriptedLlm(() => ({ ...say("ok"), usage: { input: 1000, output: 50, cached: 600 } })),
  });
  try {
    const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Audit" })).id;
    for (const text of ["first", "second"]) {
      await env.client.call("threads.send", { thread, text });
      await env.settle(thread);
    }
    // More runs than any page of the chat: older turns, one of them failed.
    const deadline_at = new Date(Date.now() + 60_000).toISOString();
    for (let i = 0; i < 25; i++) {
      const r = env.core.store.runs.create({
        thread_id: thread,
        agent_id: "roby",
        trigger: "user",
        deadline_at,
        input: { text: `turn ${i}`, origin: { kind: "user" } },
      });
      env.core.store.runs.patch(r, { model: "fake/fake-1", usage: { input: 10, output: 2 } });
      env.core.store.runs.setState(r, i === 0 ? "failed" : "completed", i === 0 ? "boom" : undefined);
    }
    const { totals } = await env.client.call("usage.summary", { thread });
    assert.ok(totals);
    assert.equal(totals.runs, 27);
    assert.equal(totals.failed, 1);
    assert.equal(totals.input, 2 * 1000 + 25 * 10);
    assert.equal(totals.output, 2 * 50 + 25 * 2);
    assert.equal(totals.cached, 2 * 600, "the provider's cache reads are kept, inside input");
    assert.ok(totals.seconds >= 0);
    assert.equal((await env.client.call("usage.summary", {})).totals, undefined, "only a chat's summary has totals");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
