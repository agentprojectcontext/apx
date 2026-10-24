import assert from "node:assert/strict";
import test from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("scoped chat processes retain old and nested descendants beyond the global list cap", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const repo = env.core.store.threads;
    const root = repo.create({ kind: "agent", title: "Root", agent_ids: ["secretary"], at: "2020-01-01T00:00:00Z" });
    const child = repo.create({ kind: "a2a", title: "Child", agent_ids: ["secretary"], parent_id: root.id });
    const nested = repo.create({ kind: "a2a", title: "Nested", agent_ids: ["secretary"], parent_id: child.id });
    for (let i = 0; i < 305; i++) repo.create({ kind: "agent", title: `Other ${i}`, agent_ids: ["secretary"] });
    const global = await env.client.call("threads.list", { include_subthreads: true });
    assert.equal(
      global.threads.some((t) => t.id === child.id),
      false,
    );
    const scoped = await env.client.call("threads.list", { root_thread: root.id, include_archived: true });
    assert.deepEqual(new Set(scoped.threads.map((t) => t.id)), new Set([child.id, nested.id]));
    const socket = await env.client.connect("operator");
    try {
      const ws = await socket.call("threads.list", { root_thread: root.id, include_archived: true });
      assert.deepEqual(new Set(ws.threads.map((t) => t.id)), new Set([child.id, nested.id]));
    } finally {
      socket.close();
    }
    repo.arrange(child.id, { archived: true });
    const visible = await env.client.call("threads.list", { root_thread: root.id });
    assert.deepEqual(
      visible.threads.map((t) => t.id),
      [nested.id],
    );
    const archived = await env.client.call("threads.list", { root_thread: root.id, include_archived: true });
    assert.equal(archived.threads.length, 2);
    await assert.rejects(env.client.call("threads.list", { root_thread: "missing" }), /thread missing/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
