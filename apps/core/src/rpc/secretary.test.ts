import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("team news adopts an existing scheduled record without losing its prompt or enabled choice", async () => {
  const llm = scriptedLlm(() => say("ok"));
  const env = await startCore({ llm });
  try {
    const old = await env.client.call("routines.set", {
      name: "Custom team news",
      agent: "roby",
      action: "relay",
      schedule: { kind: "every", minutes: 30 },
      prompt: "Only news that needs a decision",
      enabled: false,
      post_command: "echo complete",
      max_steps: 12,
    });
    const unchanged = await env.client.call("secretary.set", { action: "relay", enabled: false });
    assert.equal(unchanged.id, old.id);
    assert.equal(unchanged.prompt, old.prompt);
    assert.equal(unchanged.post_command, old.post_command);
    assert.equal(unchanged.max_steps, old.max_steps);
    assert.deepEqual(unchanged.schedule, old.schedule);
    assert.equal(unchanged.next_run_at, undefined);
    const applied = await env.client.call("profiles.set", { id: "secretary" });
    const news = applied.routines.filter((r) => r.action === "relay");
    assert.equal(news.length, 1);
    assert.equal(news[0]?.id, old.id);
    assert.equal(news[0]?.prompt, old.prompt);
    assert.equal(news[0]?.enabled, false);
    assert.deepEqual(news[0]?.schedule, old.schedule, "adoption preserves custom timing");
    assert.equal(news[0]?.post_command, old.post_command);
    assert.equal(news[0]?.next_run_at, undefined);
    const on = await env.client.call("secretary.set", { action: "relay", enabled: true });
    assert.equal(on.id, old.id);
    assert.ok(on.next_run_at);
    assert.equal(llm.calls.length, 0, "changing a capability does not start a model turn");
    await env.client.call("secretary.set", { action: "relay", enabled: false, prompt: "My revised instructions" });
    await env.client.call("profiles.set", { id: "secretary", values: { team_news_every_h: 3 } });
    await env.client.call("profiles.set", { id: null });
    const kept = env.core.store.routines.get(old.id);
    assert.equal(kept?.enabled, false);
    assert.equal(kept?.prompt, "My revised instructions");
    assert.deepEqual((await env.client.call("routines.runs", { routine: old.id })).runs, []);
    assert.equal(llm.calls.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("explicit activation without a profile creates one capability and repeated saves reuse it", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const one = await env.client.call("secretary.set", { action: "relay", enabled: true });
    const two = await env.client.call("secretary.set", { action: "relay", enabled: true });
    assert.equal(one.id, two.id);
    assert.equal(one.next_run_at, two.next_run_at, "a no-op does not postpone the next check");
    assert.equal((await env.client.call("profiles.list", {})).active.id, null);
    await env.client.call("profiles.set", { id: "secretary" });
    const all = (await env.client.call("routines.list", {})).routines;
    assert.equal(all.filter((r) => r.action === "relay").length, 1);
    await assert.rejects(
      env.client.call("secretary.set", { action: "relay", id: "missing", enabled: true }),
      /capability changed/,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
