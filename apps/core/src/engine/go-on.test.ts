import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Part } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "./testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("Done")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

for (const mode of ["reset", "release"] as const) {
  test(`${mode} persists resolved notices throughout only the resumed tree`, async () => {
    const { store } = env.core;
    const root = store.threads.create({ kind: "loose", title: "Paused work", agent_ids: ["roby"] });
    const child = store.threads.create({ kind: "loose", title: "Child work", agent_ids: ["roby"], parent_id: root.id });
    const other = store.threads.create({ kind: "loose", title: "Other work", agent_ids: ["roby"] });
    const notice = (thread: string, code: string): Part => ({
      type: "notice",
      level: "warn",
      code,
      text: "Paused",
      vars: { thread, spent: "30" },
    });
    const add = (thread: string, parts: Part[]) =>
      store.messages.add({
        thread_id: thread,
        author: { kind: "system" },
        parts,
      });
    const first = add(root.id, [notice(root.id, "breaker.paused"), { type: "text", text: "Keep this text" }]);
    const held = add(child.id, [notice(child.id, "breaker.held")]);
    const unrelated = add(other.id, [notice(other.id, "breaker.paused")]);
    const ordinary = add(root.id, [notice(root.id, "delegation.limit")]);
    for (let i = 0; i < 201; i++) add(root.id, [{ type: "text", text: "Later history" }]);

    assert.deepEqual(await env.client.call("threads.go_on", { thread: child.id, mode }), { started: 0 });
    for (const message of [first, held]) {
      const parts = store.messages.get(message.id)?.parts;
      const part = parts?.[0];
      assert.equal(part?.type === "notice" && part.vars?.resolved, mode);
      assert.deepEqual(parts?.slice(1), message.parts.slice(1));
    }
    assert.deepEqual(store.messages.get(unrelated.id), unrelated);
    assert.deepEqual(store.messages.get(ordinary.id), ordinary);

    const later = add(root.id, [notice(root.id, "breaker.paused")]);
    assert.deepEqual(store.messages.get(later.id), later);
    await env.client.call("threads.go_on", { thread: root.id, mode: mode === "reset" ? "release" : "reset" });
    const original = store.messages.get(first.id)?.parts[0];
    assert.equal(original?.type === "notice" && original.vars?.resolved, mode);
    const updated = store.messages.get(later.id)?.parts[0];
    assert.equal(updated?.type === "notice" && updated.vars?.resolved, mode === "reset" ? "release" : "reset");
  });
}
