import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import { duplicateMemory } from "../domain/memory-content.ts";
import { qb, sql } from "../domain/sql.ts";
import { waitFor } from "../testkit/platform.ts";
import { notesText } from "../tools/memory.ts";
import { supportMemoryClaims } from "./memory-testkit.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

function gate() {
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

for (const action of ["off", "archive", "delete"] as const)
  test(`capture rechecks ${action} after its model returns`, async () => {
    const entered = gate(),
      response = gate();
    const llm = scriptedLlm(async (req, { system }) => {
      if (system.startsWith("Validate memory")) return supportMemoryClaims(req);
      if (system.startsWith("Extract durable")) {
        const data = JSON.parse(String(req.messages.at(-1)?.content));
        entered.release();
        await response.wait;
        return say(
          JSON.stringify({
            memories: [{ kind: "user", message_id: data.messages[0].id, quote: data.messages[0].text }],
          }),
        );
      }
      return say("ok");
    });
    const env = await startCore({ llm, aux: true, memoryMaintenance: true });
    try {
      const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
      await env.client.call("threads.send", {
        thread: thread.id,
        text: "For Acme research I always prefer short tables.",
      });
      await env.settle(thread.id);
      await entered.wait;
      if (action === "off")
        await env.client.call("memory.set_settings", { mode: "off", skill_picker: true, auto_compact: true });
      else if (action === "archive") env.core.store.agents.archive("scout");
      else {
        env.core.store.agents.purge("scout");
        env.core.store.memories.removeAgentNotes("scout");
      }
      response.release();
      await waitFor(async () => !(await env.client.call("memory.status", {})).jobs.some((j) => j.state === "working"));
      assert.equal((await env.client.call("memory.list", {})).memories.length, 0);
    } finally {
      response.release();
      await env.core.close();
      await env.cleanup();
    }
  });

test("forged auxiliary quotes and assistant claims cannot become durable facts", async () => {
  const llm = scriptedLlm((_, { system }) =>
    system.startsWith("Extract durable")
      ? say(
          JSON.stringify({
            memories: [
              { kind: "project", message_id: "msg_missing", quote: "The production deployment finished successfully." },
            ],
          }),
        )
      : say("The production deployment finished successfully."),
  );
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: "Can you investigate the deployment?" });
    await env.settle(thread.id);
    await waitFor(async () => (await env.client.call("memory.status", {})).jobs.every((j) => j.state === "completed"));
    assert.equal((await env.client.call("memory.list", {})).memories.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("queue survives restart, expired final leases fail, and reservations stay in their original day", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  let closed = false;
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: "A short owner turn." });
    await env.settle(thread.id);
    const run = env.core.store.runs.list(thread.id, 1)[0];
    assert.ok(run);
    const job = {
      id: "capture:restart",
      kind: "capture" as const,
      agent_id: "roby",
      thread_id: thread.id,
      run_id: run.id,
    };
    env.core.store.memoryWork.enqueue(job);
    const db = openDb(env.home),
      q = sql(db);
    q.run(
      qb
        .updateTable("memory_work")
        .set({ state: "working", attempts: 3, lease_until: "2000-01-01T00:00:00Z" })
        .where("id", "=", job.id),
    );
    env.core.store.memoryWork.pending();
    assert.equal(env.core.store.memoryWork.recent().find((j) => j.id === job.id)?.state, "failed");
    const fresh = { ...job, id: "capture:budget" };
    env.core.store.memoryWork.enqueue(fresh);
    assert.ok(env.core.store.memoryWork.claim(fresh.id));
    assert.equal(env.core.store.memoryWork.reserve(fresh.id, 1), true);
    q.run(qb.updateTable("memory_call_reservations").set({ day: "2000-01-01" }));
    assert.equal(
      env.core.store.memoryWork.reserve(fresh.id, 1),
      true,
      "yesterday's reservation cannot consume today's quota",
    );
    assert.equal(env.core.store.memoryWork.reserve(fresh.id, 1), false);
    db.close();
    await env.core.close();
    closed = true;
    const restarted = await startCore({ home: env.home, llm: scriptedLlm(() => say("ok")) });
    assert.equal(restarted.core.store.memoryWork.recent().find((j) => j.id === job.id)?.state, "failed");
    await restarted.core.close();
  } finally {
    if (!closed) await env.core.close();
    await env.cleanup();
  }
});

test("consolidation rejects duplicate IDs, opposing signs and reordered preferences", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const note = env.core.store.memories.add({
      scope: "agent",
      agent_id: "roby",
      source: "agent",
      text: "Invoices use amber labels.",
    });
    assert.equal(
      env.core.store.memories.consolidate(
        [
          { id: note.id, revision: 1 },
          { id: note.id, revision: 1 },
        ],
        { agent_id: "roby" },
      ),
      false,
    );
    assert.equal(env.core.store.memories.get(note.id)?.forgotten_at, undefined);
    assert.equal(duplicateMemory("Temperature -5 degrees", "Temperature 5 degrees"), false);
    assert.equal(duplicateMemory("Amount > 20", "Amount < 20"), false);
    assert.equal(duplicateMemory("Prefer email over SMS", "Prefer SMS over email"), false);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("one oversized note cannot hide a later relevant note", () => {
  const base = {
    id: "mem_large",
    scope: "global" as const,
    source: "owner" as const,
    tainted: false,
    pending: false,
    created_at: "2000-01-01",
    updated_at: "2000-01-01",
  };
  const result = notesText([
    { ...base, text: "x".repeat(2400) },
    { ...base, id: "mem_short", text: "Invoices use amber labels." },
  ]);
  assert.match(result.text ?? "", /amber labels/);
  assert.deepEqual(result.ids, ["mem_short"]);
});

test("deleting an agent removes private revision text as well as live notes", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const note = env.core.store.memories.add({
      scope: "agent",
      agent_id: "scout",
      source: "agent",
      text: "Acme archives use violet labels.",
    });
    assert.equal(env.core.store.memories.history(note.id).length, 1);
    env.core.store.memories.removeAgentNotes("scout");
    assert.equal(env.core.store.memories.get(note.id), undefined);
    assert.equal((await env.client.call("memory.history", { id: note.id })).versions.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("an interrupted capture resumes once after restart without duplicate memories", async () => {
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Validate memory")) return supportMemoryClaims(req);
    if (system.startsWith("Extract durable")) {
      const source = JSON.parse(String(req.messages.at(-1)?.content)).messages[0];
      return say(
        JSON.stringify({
          memories: [{ kind: "project", message_id: source.id, quote: source.text, fact: source.text }],
        }),
      );
    }
    if (system.startsWith("Review private")) return say('{"groups":[]}');
    return say("ok");
  });
  let env = await startCore({ llm });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", {
      thread: thread.id,
      text: "Acme always archives invoices with violet labels.",
    });
    await env.settle(thread.id);
    const run = env.core.store.runs.list(thread.id, 1)[0];
    assert.ok(run);
    env.core.store.settings.set("model_aux", "fake/fake-1");
    env.core.store.settings.write("memory", {
      mode: "notes",
      skill_picker: true,
      auto_compact: false,
      auto_capture: true,
      auto_dream: false,
    });
    const db = openDb(env.home),
      q = sql(db);
    q.run(
      qb
        .updateTable("memory_work")
        .set({ state: "working", attempts: 1, lease_until: "2000-01-01T00:00:00Z" })
        .where("id", "=", `capture:${run.id}`),
    );
    db.close();
    const home = env.home;
    await env.core.close();
    env = await startCore({ home, llm, aux: true, memoryMaintenance: true });
    await waitFor(async () =>
      (await env.client.call("memory.status", {})).jobs
        .filter((j) => j.kind === "capture")
        .every((j) => j.state === "completed"),
    );
    const notes = (await env.client.call("memory.list", {})).memories;
    assert.equal(notes.length, 1);
    assert.match(notes[0]?.text ?? "", /violet labels/);
    await env.client.call("memory.maintenance", { backfill: true });
    assert.equal((await env.client.call("memory.list", {})).memories.length, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
