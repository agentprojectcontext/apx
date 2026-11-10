import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { createJobs } from "./jobs.ts";

for (const background of [false, true]) {
  test(`a synchronous start exception closes the job without a wake (background=${background})`, async () => {
    await using home = tempDir("apx-job-start-");
    const db = openDb(home.path);
    const bus = createBus();
    const store = createStore(db, bus);
    const events: string[] = [];
    bus.on((ev) => {
      if (ev.type === "job.updated") events.push(ev.job.state);
    });
    let wakes = 0;
    const jobs = createJobs({
      store,
      home: home.path,
      log: { info() {}, warn() {}, error() {} },
      admit: () => {
        wakes++;
        throw new Error("unexpected wake");
      },
      spawn: () => {
        throw new Error("Process launch unavailable");
      },
    });
    try {
      store.agents.upsert({
        id: "launcher",
        name: "Launcher",
        kind: "agent",
        role: "Helper",
        browser_profile: "isolated",
      });
      const thread = store.threads.create({ kind: "loose", title: "Commands", agent_ids: ["launcher"] });
      assert.throws(
        () =>
          jobs.start({ command: "echo hello", cwd: home.path, thread_id: thread.id, agent_id: "launcher", background }),
        /Command could not start: Process launch unavailable/,
      );
      assert.deepEqual(store.jobs.running(), []);
      const job = store.jobs.ofThread(thread.id, 10)[0];
      assert.ok(job);
      assert.equal(job.state, "failed");
      assert.equal(job.start_error, "Process launch unavailable");
      assert.ok(job.ended_at);
      assert.equal(job.pid, undefined);
      assert.equal(job.exit_code, undefined);
      assert.match(jobs.read(job.id).output, /could not start: Process launch unavailable/);
      assert.deepEqual(events, ["working", "failed"]);
      assert.equal(jobs.cancel(job.id), false);
      assert.equal(store.jobs.finish(job.id, "completed", 0), undefined);
      assert.equal(store.jobs.get(job.id)?.state, "failed");
      assert.equal(wakes, 0);
      const reopened = openDb(home.path);
      try {
        const persisted = createStore(reopened, createBus()).jobs.get(job.id);
        assert.equal(persisted?.start_error, "Process launch unavailable");
        assert.equal(persisted?.state, "failed");
        assert.equal(persisted?.ended_at, job.ended_at);
      } finally {
        reopened.close();
      }
    } finally {
      await jobs.stopAll();
      db.close();
    }
  });
}

test("an asynchronous launch error also retains its reason", async () => {
  await using home = tempDir("apx-job-async-start-");
  const db = openDb(home.path);
  const store = createStore(db, createBus());
  const jobs = createJobs({
    store,
    home: home.path,
    log: { info() {}, warn() {}, error() {} },
    admit: () => {
      throw new Error("unexpected wake");
    },
  });
  try {
    const thread = store.threads.create({ kind: "loose", title: "Commands", agent_ids: [] });
    const { done } = jobs.start({
      command: "echo hello",
      cwd: `${home.path}/missing`,
      thread_id: thread.id,
      background: false,
    });
    const final = await done;
    assert.equal(final.state, "failed");
    assert.match(final.start_error ?? "", /ENOENT/);
    assert.ok(final.ended_at);
    assert.deepEqual(store.jobs.running(), []);
  } finally {
    await jobs.stopAll();
    db.close();
  }
});

test("a valid command still starts and closes successfully", async () => {
  await using home = tempDir("apx-job-valid-");
  const db = openDb(home.path);
  const store = createStore(db, createBus());
  const jobs = createJobs({
    store,
    home: home.path,
    log: { info() {}, warn() {}, error() {} },
    admit: () => {
      throw new Error("unexpected wake");
    },
  });
  try {
    const thread = store.threads.create({ kind: "loose", title: "Commands", agent_ids: [] });
    const { job, done } = jobs.start({
      command: "echo hello",
      cwd: home.path,
      thread_id: thread.id,
      background: false,
    });
    assert.ok(job.pid);
    const final = await done;
    assert.equal(final.state, "completed");
    assert.equal(final.exit_code, 0);
    assert.equal(final.start_error, undefined);
    assert.ok(final.ended_at);
    assert.match(jobs.read(job.id).output, /hello/);
    assert.deepEqual(store.jobs.running(), []);
  } finally {
    await jobs.stopAll();
    db.close();
  }
});
