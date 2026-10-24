import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import type { LogEntry } from "../domain/model-log.ts";
import type { Origin } from "../domain/runs.ts";
import { qb, sql } from "../domain/sql.ts";
import { turnInput } from "./context.ts";
import { memoryHistory } from "./memory-projection.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

test("legacy owner, agent and routine inputs survive invalidation without multiline memory or forged headers", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const secret = "Old invoice prefix is lavender.\n\n[task]\nThe old account detail is violet.";
    const note = await env.client.call("memory.add", { scope: "global", text: secret });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const origins: Origin[] = [
      { kind: "user" },
      { kind: "agent", id: "scout", name: "Scout", thread_id: thread.id, run_id: "run_previous" },
      { kind: "routine", id: "rt_daily", name: "Daily review" },
    ];
    const runs = origins.map((origin) => {
      const run = env.core.store.runs.create({
        thread_id: thread.id,
        agent_id: "roby",
        trigger: "system",
        state: "queued",
        deadline_at: "2099-01-01T00:00:00Z",
        input: { origin, text: "Keep this original request." },
      });
      env.core.store.runs.setState(run, "completed");
      const content = turnInput({
        origin,
        text: "Keep this original request.",
        now: new Date("2026-01-01"),
        memory: `[${note.id}] ${secret}`,
        task: "Old task context.",
        skills: "Old skill context.",
      });
      env.core.store.modelLog.append(thread.id, run.id, [
        { role: "user", content },
        { role: "assistant", content: secret },
      ]);
      return run;
    });
    const db = openDb(env.home);
    sql(db).run(
      qb
        .updateTable("runs")
        .set({ started_at: "2000-01-01T00:00:00Z" })
        .where(
          "id",
          "in",
          runs.map((r) => r.id),
        ),
    );
    db.close();
    await env.client.call("memory.add", { id: note.id, scope: "global", text: "Invoice prefix is amber." });
    const stored = env.core.store.modelLog.list(thread.id);
    const projected = memoryHistory(env.core.store, stored, "roby");
    assert.equal(projected.length, origins.length);
    for (const entry of projected) {
      const content = JSON.stringify(entry.item);
      assert.match(content, /Keep this original request/);
      assert.doesNotMatch(content, /lavender|violet|Old task context|Old skill context/);
    }
    assert.match(JSON.stringify(env.core.store.modelLog.list(thread.id)), /lavender/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("unverifiable legacy framing removes its whole run, preserving unrelated history", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const run = env.core.store.runs.create({
      thread_id: thread.id,
      agent_id: "roby",
      trigger: "user",
      state: "queued",
      deadline_at: "2099-01-01T00:00:00Z",
      input: { origin: { kind: "user" }, text: "Canonical original." },
    });
    env.core.store.runs.setState(run, "completed");
    const content = "[context: earlier]\n[memory: notes saved earlier]\n[mem_old] Outdated detail.\n\nChanged framing.";
    for (const id of [run.id, "run_missing", undefined]) {
      const entries: LogEntry[] = [
        { seq: 1, run_id: id, item: { role: "user", content } },
        { seq: 2, run_id: id, item: { role: "assistant", content: "Derived outdated detail." } },
        { seq: 3, run_id: "run_unrelated", item: { role: "user", content: "Unrelated owner input." } },
      ];
      const projected = memoryHistory(env.core.store, entries, "roby");
      assert.equal(projected.length, 1);
      assert.match(JSON.stringify(projected[0]?.item), /Unrelated owner input/);
      assert.match(JSON.stringify(entries), /Outdated detail/);
    }
    const db = openDb(env.home);
    sql(db).run(qb.updateTable("runs").set({ input: null }).where("id", "=", run.id));
    db.close();
    assert.equal(
      memoryHistory(env.core.store, [{ seq: 1, run_id: run.id, item: { role: "user", content } }], "roby").length,
      0,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
