import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ProviderError } from "../providers/types.ts";
import { tempDir } from "../testkit/platform.ts";
import { continuationCanStart } from "./continuations.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const start = Date.parse("2026-10-05T10:00:00Z");
const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
const request = { purpose: "Read the report", condition: { kind: "time" as const, at: at(10) }, expires_at: at(60) };

for (const stage of ["pending", "admitted"] as const) {
  test(`a working-folder change revokes a ${stage} code-chat follow-up`, async () => {
    await using dir = tempDir("apx-followup-scope-");
    const child = path.join(dir.path, "checkout");
    fs.mkdirSync(child);
    const llm = scriptedLlm(() => say("Must not run in another folder"));
    let clock = new Date(start);
    const f = await startCore({ llm, clock: () => clock });
    try {
      const { project } = await f.client.call("projects.register", { path: dir.path, init: true });
      const thread = await f.client.call("threads.create", {
        kind: "code",
        agent_id: "superagent",
        project_id: project.id,
        cwd: child,
        write: "read-only",
      });
      const item = await f.client.call("continuations.create", { thread: thread.id, ...request });
      const run =
        stage === "admitted"
          ? f.core.store.runs.create({
              thread_id: thread.id,
              agent_id: "superagent",
              trigger: "system",
              input: { origin: { kind: "continuation", id: item.id }, text: item.purpose },
              deadline_at: at(60),
            })
          : undefined;
      if (run) {
        f.core.store.continuations.change(item.id, "pending", "admitted", { run_id: run.id });
        assert.equal(continuationCanStart(f.core.store, run, new Date(at(10))), true);
      }
      if (run) f.core.store.threads.workIn(thread.id, { cwd: dir.path, write: "read-only" });
      else await f.client.call("threads.update", { thread: thread.id, cwd: dir.path });
      const changed = f.core.store.threads.get(thread.id);
      assert.equal(changed?.write, thread.write, "the folder changed without changing the write policy");
      clock = new Date(at(10));
      if (run) assert.equal(continuationCanStart(f.core.store, run, clock), false);
      else f.core.scheduler.tick();
      assert.equal(f.core.store.continuations.get(item.id)?.value.state, "blocked");
      assert.equal(llm.calls.length, 0);
    } finally {
      await f.core.close();
      await f.cleanup();
    }
  });
}

test("a moved task's new title never enters the original follow-up receipt", async () => {
  let clock = new Date(start);
  const llm = scriptedLlm(() => say("Must not read the other project"));
  const f = await startCore({ llm, clock: () => clock });
  try {
    f.core.store.projects.upsert({ id: "northwind", name: "Northwind" });
    const task = await f.client.call("tasks.create", { title: "Public report" });
    const item = await f.client.call("continuations.create", {
      ...request,
      thread: "home",
      condition: { kind: "task_done", task: task.id },
    });
    const receipts = () => f.core.store.messages.notices("home", "continuation.receipt");
    assert.match(JSON.stringify(receipts()), /Public report/);
    const privateTitle = "Northwind confidential report";
    await f.client.call("tasks.update", { task: task.id, project: "northwind", title: privateTitle });
    clock = new Date(at(10));
    f.core.scheduler.tick();
    assert.equal(f.core.store.continuations.get(item.id)?.value.state, "blocked");
    assert.doesNotMatch(JSON.stringify(receipts()), new RegExp(privateTitle));
    const transcript = await f.client.call("threads.get", { thread: "home" });
    assert.doesNotMatch(JSON.stringify(transcript), new RegExp(privateTitle));
    assert.equal(llm.calls.length, 0);
  } finally {
    await f.core.close();
    await f.cleanup();
  }
});

test("expiry does not claim an already completed task failed to finish", async () => {
  let clock = new Date(start);
  const llm = scriptedLlm(() => say("Must not start after expiry"));
  const f = await startCore({ llm, clock: () => clock });
  try {
    const task = await f.client.call("tasks.create", { title: "Finished cycle" });
    const item = await f.client.call("continuations.create", {
      ...request,
      thread: "home",
      condition: { kind: "task_done", task: task.id },
      expires_at: at(15),
    });
    await f.client.call("tasks.close", { task: task.id, state: "done" });
    clock = new Date(at(20));
    f.core.scheduler.tick();
    assert.equal(f.core.store.continuations.get(item.id)?.value.state, "expired");
    const part = f.core.store.messages.notices("home", "continuation.receipt")[0]?.parts[0];
    assert.ok(part?.type === "notice" && part.vars?.reason === "ready_expired");
    assert.equal(llm.calls.length, 0);
  } finally {
    await f.core.close();
    await f.cleanup();
  }
});

test("provider-limit recovery never readmits a terminal continuation or adds a spurious run", async () => {
  let clock = new Date(start);
  const llm = scriptedLlm(() => {
    throw new ProviderError("quota", "The model provider's usage limit was reached");
  });
  const f = await startCore({ llm, clock: () => clock });
  try {
    const item = await f.client.call("continuations.create", { thread: "home", ...request });
    clock = new Date(at(10));
    f.core.scheduler.tick();
    const stopped = await f.settle("home");
    const run = stopped.runs[0];
    assert.ok(run?.ended_at);
    assert.equal(run.end_reason, "provider_limit");
    assert.equal(f.core.store.continuations.get(item.id)?.value.state, "failed");
    const calls = llm.calls.length;
    // The persisted end is the anchor: advancing two hours crosses the one-hour unsaid-reset grace.
    clock = new Date(Date.parse(run.ended_at) + 2 * 3600_000);
    for (let i = 0; i < 2; i++) {
      f.core.scheduler.tick();
      await f.settle("home");
    }
    const after = await f.client.call("threads.get", { thread: "home" });
    assert.deepEqual(
      after.runs.map((r) => r.id),
      [run.id],
    );
    assert.equal(f.core.store.continuations.get(item.id)?.value.run_id, run.id);
    assert.equal(llm.calls.length, calls);
  } finally {
    await f.core.close();
    await f.cleanup();
  }
});
