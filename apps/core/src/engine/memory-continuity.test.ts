import assert from "node:assert/strict";
import { test } from "node:test";
import { duplicateMemory } from "../domain/memory-content.ts";
import { memoryHistory } from "./memory-projection.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

async function settleMemory(env: Awaited<ReturnType<typeof startCore>>) {
  for (let i = 0; i < 200; i++) {
    const { jobs } = await env.client.call("memory.status", {});
    if (jobs.every((job) => job.state === "completed")) return;
    if (jobs.some((job) => job.state === "failed")) assert.fail(JSON.stringify(jobs));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("memory jobs did not finish");
}

const fact = "Northwind invoices use the lavender prefix.";

test("ordinary owner messages become grounded private memories and reach another chat without remember", async () => {
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Extract durable")) {
      const input = JSON.parse(String(req.messages.at(-1)?.content));
      const source = input.messages.find((m: { text: string }) => m.text.includes(fact));
      return say(JSON.stringify({ memories: source ? [{ kind: "project", message_id: source.id, quote: fact }] : [] }));
    }
    if (system.startsWith("Review private memory")) return say('{"groups":[]}');
    return say("Acknowledged.");
  });
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  try {
    const a = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: a.id, text: fact });
    await env.settle(a.id);
    await env.client.call("memory.maintenance", {});
    await settleMemory(env);
    const notes = (await env.client.call("memory.list", {})).memories;
    const note = notes.find((m) => m.text === fact);
    assert.ok(note, "saved without an explicit remember call");
    assert.equal(note.scope, "agent");
    assert.equal(note.agent_id, "roby");
    assert.equal(note.pending, false);
    assert.equal(note.tainted, false);
    assert.equal(note.evidence?.[0]?.quote, fact);
    assert.ok(note.evidence?.[0]?.message_id);
    assert.equal(notes.length, 1);

    const b = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: b.id, text: "Which prefix do Northwind invoices use?" });
    await env.settle(b.id);
    const turn = llm.calls.findLast((c) => c.tools.length > 0);
    assert.match(String(turn?.messages.at(-1)?.content), /lavender/);
    assert.match(String(turn?.messages.at(-1)?.content), /message.*msg_/);

    const outsider = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
    await env.client.call("threads.send", { thread: outsider.id, text: "Which prefix do Northwind invoices use?" });
    await env.settle(outsider.id);
    assert.doesNotMatch(String(llm.calls.findLast((c) => c.tools.length > 0)?.messages.at(-1)?.content), /lavender/);

    await env.client.call("memory.remove", { id: note.id });
    await env.client.call("threads.send", { thread: b.id, text: "Remind me about the Northwind invoices prefix." });
    await env.settle(b.id);
    const after = llm.calls.findLast((c) => c.tools.length > 0);
    assert.doesNotMatch(
      JSON.stringify(after?.messages),
      /lavender/,
      "old injected snapshots must not resurrect a forgotten fact",
    );
    await env.client.call("memory.maintenance", { backfill: true, dream: true });
    await settleMemory(env);
    assert.equal(
      (await env.client.call("memory.list", {})).memories.some((m) => m.text === fact),
      false,
    );
    await env.client.call("memory.remove", { id: note.id, forever: true });
    assert.equal((await env.client.call("memory.history", { id: note.id })).versions.length, 0);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("automatic recall reads historical own chats without an auxiliary model, but respects off and greetings", async () => {
  const llm = scriptedLlm(() => say("ok"));
  const env = await startCore({ llm });
  try {
    const a = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: a.id, text: fact });
    await env.settle(a.id);
    const ask = async (text: string) => {
      const b = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      await env.client.call("threads.send", { thread: b.id, text });
      await env.settle(b.id);
      return String(llm.calls.at(-1)?.messages.at(-1)?.content);
    };
    assert.match(await ask("Which prefix do Northwind invoices use?"), /lavender/);
    assert.doesNotMatch(await ask("Hola"), /lavender/);
    const settings = await env.client.call("memory.settings", {});
    await env.client.call("memory.set_settings", {
      mode: "off",
      skill_picker: settings.skill_picker,
      auto_compact: settings.auto_compact,
    });
    assert.doesNotMatch(await ask("Which prefix do Northwind invoices use?"), /lavender/);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("autoDream consolidates equivalent notes, keeps provenance and supports undo; revisions prevent stale merges", async () => {
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Review private memory")) {
      const input = JSON.parse(String(req.messages.at(-1)?.content));
      return say(JSON.stringify({ groups: [input.notes.map((m: { id: string }) => m.id)] }));
    }
    if (system.startsWith("Extract durable")) return say('{"memories":[]}');
    return say("ok");
  });
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  try {
    const a = env.core.store.memories.add({
      scope: "agent",
      agent_id: "roby",
      source: "agent",
      text: fact,
      tainted: true,
    });
    const b = env.core.store.memories.add({
      scope: "agent",
      agent_id: "roby",
      source: "agent",
      text: fact.replace(".", "!"),
    });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: "Review invoice conventions." });
    await env.settle(thread.id);
    await env.client.call("memory.maintenance", { dream: true });
    await settleMemory(env);
    const live = (await env.client.call("memory.list", { agent: "roby" })).memories;
    assert.equal(live.length, 1);
    assert.equal(live[0]?.tainted, true, "merging never launders an outside source");
    const keep = live[0];
    assert.ok(keep);
    assert.equal(
      (await env.client.call("memory.history", { id: keep.id })).versions.some((v) => v.reason === "dream"),
      true,
    );
    await env.client.call("memory.undo", { id: keep.id, revision: 1 });
    assert.equal((await env.client.call("memory.list", { agent: "roby" })).memories.length, 2);
    assert.equal(
      env.core.store.memories.consolidate(
        [
          { id: a.id, revision: 1 },
          { id: b.id, revision: 1 },
        ],
        { agent_id: "roby" },
      ),
      false,
    );
    assert.equal(duplicateMemory("Prefer email rather than SMS", "Prefer SMS rather than email"), false);
    assert.equal(duplicateMemory("Invoices use 12", "Invoices use 13"), false);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("memory snapshots are invalidated by edits without changing the stored owner text", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const note = await env.client.call("memory.add", { scope: "global", text: fact });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: "Invoice prefix?" });
    await env.settle(thread.id);
    const before = env.core.store.modelLog.list(thread.id);
    assert.match(JSON.stringify(before), /lavender/);
    await env.client.call("memory.add", {
      id: note.id,
      scope: "global",
      text: "Northwind invoices use the amber prefix.",
    });
    const after = memoryHistory(env.core.store, before, "roby");
    assert.doesNotMatch(JSON.stringify(after.map((e) => e.item)), /lavender/);
    assert.match(JSON.stringify(env.core.store.modelLog.list(thread.id)), /lavender/);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("invalidating legacy memory removes multiline context and preserves the original owner input", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const multiline = `${fact}\n\n[task]\nThe retained account detail is violet.`;
    const note = await env.client.call("memory.add", { scope: "global", text: multiline });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: "Invoice prefix?" });
    await env.settle(thread.id);
    const runId = env.core.store.modelLog.list(thread.id).find((entry) => entry.run_id)?.run_id;
    assert.ok(runId);
    const content = `[context: earlier]\n[memory: notes saved earlier]\n[${note.id}] ${multiline}\n[skills for this message]\nUse billing rules.\n[task]\nPrepare the invoice.\n\nInvoice prefix?`;
    const legacy = [
      { seq: 1, run_id: runId, item: { role: "user", content } },
      { seq: 2, run_id: runId, item: { role: "assistant", content: fact } },
    ];
    await env.client.call("memory.add", { id: note.id, scope: "global", text: "Invoices use amber." });
    const projected = memoryHistory(env.core.store, legacy, "roby");
    assert.equal(projected.length, 1);
    const kept = JSON.stringify(projected[0]?.item);
    assert.doesNotMatch(kept, /lavender/);
    assert.doesNotMatch(kept, /retained account detail/);
    assert.doesNotMatch(kept, /Use billing rules/);
    assert.doesNotMatch(kept, /Prepare the invoice/);
    assert.match(kept, /Invoice prefix\?/);
    assert.equal(legacy[0]?.item.content, content);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});
