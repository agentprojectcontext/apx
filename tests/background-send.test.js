// Leaving work running, and being woken when it ends.
//
// The turn this comes from (2026-09-11): Ansel needed to tell Roby something,
// had no non-blocking way to do it, shelled out to `apx send … --deliver`, ate
// run_shell's 60 s SIGTERM over a message that HAD been delivered, reported
// "sent ✅" off that failure, and closed its turn. Roby's answer landed on the
// thread nine minutes later and nobody ever read it.
//
// Each test below is one link of that chain, asserted not to happen again.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-bgsend-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { sendInBackground, deliverWake, wakeText, MAX_BACKGROUND_DEPTH } =
  await import("#core/agent/a2a/background.js");
const {
  readJob, listJobs, openJob, closeJob,
  MAX_OPEN_JOBS_PER_AGENT, BACKGROUND_JOBS_DIR,
} = await import("#core/stores/background-jobs.js");
const { reconcileBackgroundJobs } = await import("#host/daemon/background-jobs-reconciler.js");

function fresh() {
  try { fs.rmSync(BACKGROUND_JOBS_DIR, { recursive: true, force: true }); } catch { /* nothing there */ }
}

const project = { id: 7, path: "/tmp/northwind", storagePath: "/tmp/northwind-store", name: "northwind", config: {} };

/** A fake peer that answers when the test says so. Records every call, so the
 *  wake-up can be inspected as the message it really is. */
function peerStub() {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const fn = async (args) => {
    calls.push(args);
    // The first call is the outbound send; later ones are wake-ups, which must
    // not block on the gate or a test could never observe them.
    if (calls.length === 1) return gate;
    return { text: "ack", thread: "t" };
  };
  return { fn, calls, answer: (text) => release({ text, thread: "ansel~roby" }), fail: (e) => release(Promise.reject(e)) };
}

/** A peer that answers at once and records every call. For the paths that do
 *  not need to observe the middle of a run. */
function recorder() {
  const calls = [];
  return { calls, fn: async (args) => { calls.push(args); return { text: "ack", thread: "t" }; } };
}

/** Wait until `check()` returns truthy, or fail loudly. Beats a fixed sleep:
 *  the promise chain settles in microtasks, not on a clock. */
async function until(check, what, tries = 200) {
  for (let i = 0; i < tries; i++) {
    const v = check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

// ── The turn is not held ────────────────────────────────────────────────────
test("the sender gets its turn back immediately, while the peer is still working", async () => {
  fresh();
  const peer = peerStub();

  const out = sendInBackground({
    project, from: "ansel", to: "roby", body: "knot status", wake: true,
    messagePeerFn: peer.fn,
  });

  // Returned NOW — this is the whole feature. The peer has not answered.
  assert.equal(out.ok, true);
  assert.match(out.job_id, /^bgjob_/);
  assert.equal(out.status, "running");
  assert.equal(out.thread, "ansel~roby");
  assert.match(out.note, /do NOT wait for it/i);

  await until(() => peer.calls.length === 1, "the peer to be called");
  assert.equal(readJob(out.job_id).status, "running", "still running while the peer works");

  peer.answer("the MCP is not registered");
  await until(() => readJob(out.job_id).status === "done", "the job to close");
});

// ── The wake-up ─────────────────────────────────────────────────────────────
test("when the peer answers, the waiter is woken with the result — on the same thread, in reverse", async () => {
  fresh();
  const peer = peerStub();
  sendInBackground({
    project, from: "ansel", to: "roby", body: "knot status", wake: true,
    messagePeerFn: peer.fn,
  });

  await until(() => peer.calls.length === 1, "the outbound send");
  peer.answer("the MCP is not registered");
  const wake = await until(() => peer.calls[1], "the wake-up");

  // Reversed: the one who WORKED writes back to the one who WAITED, so the
  // wake-up lands in the thread the request already lives in.
  assert.equal(wake.from, "roby");
  assert.equal(wake.to, "ansel");
  assert.match(wake.body, /has finished/);
  assert.match(wake.body, /the MCP is not registered/, "it carries the actual answer");
  assert.match(wake.body, /knot status/, "and recaps what was asked, for a fresh context");
  assert.match(wake.body, /not waiting on anything any more/i);
});

test("a job that does not ask to be woken is not woken", async () => {
  fresh();
  const peer = peerStub();
  const out = sendInBackground({
    project, from: "ansel", to: "roby", body: "fyi", wake: false,
    messagePeerFn: peer.fn,
  });
  assert.match(out.note, /will NOT be woken/);

  await until(() => peer.calls.length === 1, "the outbound send");
  peer.answer("noted");
  await until(() => readJob(out.job_id).status === "done", "the job to close");

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(peer.calls.length, 1, "no wake-up was sent");
});

test("a peer that fails wakes the waiter with the failure, never dressed up as an answer", async () => {
  fresh();
  const peer = peerStub();
  const out = sendInBackground({
    project, from: "ansel", to: "roby", body: "knot status", wake: true,
    messagePeerFn: peer.fn,
  });

  await until(() => peer.calls.length === 1, "the outbound send");
  peer.fail(new Error("roby never answered"));

  const wake = await until(() => peer.calls[1], "the wake-up");
  assert.equal(readJob(out.job_id).status, "failed");
  // This is the assertion the incident is actually about: an agent reported
  // success off a failure. The wake-up must make that impossible to misread.
  assert.match(wake.body, /did NOT produce an answer/);
  assert.match(wake.body, /roby never answered/);
  assert.match(wake.body, /Do NOT report this as done/);
});

// ── Idempotency ─────────────────────────────────────────────────────────────
test("a job already claimed is never delivered twice, however many callers arrive", async () => {
  fresh();
  const job = openJob({ project_id: 7, from: "ansel", to: "roby", body: "x", wake: true });
  const done = closeJob(job.id, { status: "done", result: "answer" });
  const peer = recorder();

  const first = await deliverWake(done, { project, messagePeerFn: peer.fn });
  const second = await deliverWake(done, { project, messagePeerFn: peer.fn });
  const third = await deliverWake(done, { project, messagePeerFn: peer.fn });

  assert.equal(first.delivered, true);
  assert.deepEqual([second.delivered, third.delivered], [false, false]);
  assert.equal(second.reason, "already delivered");
  assert.equal(peer.calls.length, 1, "the waiter was messaged exactly once");
});

test("a wake-up that cannot be sent reports why instead of throwing into the daemon", async () => {
  fresh();
  const job = closeJob(openJob({ from: "ansel", to: "roby", wake: true }).id, { status: "done", result: "r" });
  const out = await deliverWake(job, {
    project,
    messagePeerFn: async () => { throw new Error("engine down"); },
  });
  assert.deepEqual(out, { delivered: false, reason: "engine down" });
});

// ── The fan-out walls ───────────────────────────────────────────────────────
test("an agent cannot leave more than its share of work running", () => {
  fresh();
  const peer = peerStub();
  const args = { project, from: "ansel", to: "roby", body: "x", messagePeerFn: peer.fn };

  for (let i = 0; i < MAX_OPEN_JOBS_PER_AGENT; i++) {
    assert.equal(sendInBackground(args).ok, true);
  }
  const refused = sendInBackground(args);
  assert.equal(refused.ok, undefined);
  // Returned, not thrown: the model has to be able to read this and change plan.
  assert.match(refused.error, /already have 3 jobs running/);
  assert.match(refused.error, /limit 3/);
});

test("a chain of hand-offs stops at the depth wall", () => {
  fresh();
  const peer = peerStub();
  const refused = sendInBackground({
    project, from: "ansel", to: "roby", body: "x", depth: MAX_BACKGROUND_DEPTH,
    messagePeerFn: peer.fn,
  });
  assert.match(refused.error, /depth limit \(3\) reached/);
  assert.equal(listJobs().length, 0, "a refused hand-off opens no job");
});

test("a send with nowhere to go is refused rather than opening a job nobody can close", () => {
  fresh();
  assert.match(sendInBackground({ project, from: "ansel" }).error, /from and to are required/);
  assert.match(sendInBackground({ from: "ansel", to: "roby" }).error, /no project/);
  assert.equal(listJobs().length, 0);
});

// ── Recovery ────────────────────────────────────────────────────────────────
test("a job whose daemon died is closed as lost and its waiter woken once", async () => {
  fresh();
  const job = openJob({ project_id: 7, from: "ansel", to: "roby", body: "knot status", wake: true });
  // Re-home it on a process that is not running: this is exactly the state a
  // job from a previous daemon is in at the next boot.
  fs.writeFileSync(
    path.join(BACKGROUND_JOBS_DIR, `${job.id}.json`),
    JSON.stringify({ ...job, daemon_pid: 2147483646 }),
  );

  const woke = [];
  const deliverWakeFn = async (settled) => { woke.push(settled); return { delivered: true }; };
  const projects = { get: () => project };

  const out = await reconcileBackgroundJobs({ projects, config: {}, log: () => {}, deliverWakeFn });
  assert.equal(out.closed, 1);
  assert.equal(out.woken, 1);
  assert.equal(readJob(job.id).status, "lost");
  assert.equal(woke.length, 1);
  assert.equal(woke[0].status, "lost");
  assert.match(woke[0].result, /daemon holding it exited/);

  // A second boot must not wake anybody again: the job is terminal now.
  const again = await reconcileBackgroundJobs({ projects, config: {}, log: () => {}, deliverWakeFn });
  assert.equal(again.closed, 0);
  assert.equal(woke.length, 1, "a recovered job is recovered exactly once");
});

test("the reconciler leaves live work alone", async () => {
  fresh();
  const mine = openJob({ project_id: 7, from: "ansel", to: "roby", timeout_s: 3600 });
  const out = await reconcileBackgroundJobs({ projects: { get: () => project }, log: () => {} });
  assert.equal(out.closed, 0);
  assert.equal(readJob(mine.id).status, "running", "a job this process still owns is not harvested");
});

test("a job past its deadline is cut off even though its owner is alive", async () => {
  fresh();
  const job = openJob({ project_id: 7, from: "ansel", to: "roby", wake: false, timeout_s: 1 });
  fs.writeFileSync(
    path.join(BACKGROUND_JOBS_DIR, `${job.id}.json`),
    JSON.stringify({ ...job, deadline_at: new Date(Date.now() - 1000).toISOString() }),
  );

  const out = await reconcileBackgroundJobs({ projects: { get: () => project }, log: () => {} });
  assert.equal(out.closed, 1);
  assert.equal(readJob(job.id).status, "timed_out");
  assert.match(readJob(job.id).result, /past its 1s budget/);
});

test("a job whose project is gone is still closed, so nothing waits on it forever", async () => {
  fresh();
  const job = openJob({ project_id: 999, from: "ansel", to: "roby", wake: true });
  fs.writeFileSync(
    path.join(BACKGROUND_JOBS_DIR, `${job.id}.json`),
    JSON.stringify({ ...job, daemon_pid: 2147483646 }),
  );

  const out = await reconcileBackgroundJobs({ projects: { get: () => null }, log: () => {} });
  assert.equal(out.closed, 1);
  assert.equal(out.woken, 0);
  assert.equal(readJob(job.id).status, "lost");
});

// ── The words the waiter reads ──────────────────────────────────────────────
test("a lost job says the work is unrecoverable, not that it is still coming", () => {
  const job = { id: "bgjob_x", to: "roby", body: "knot status", status: "lost", timeout_s: 3600 };
  const text = wakeText(job);
  assert.match(text, /daemon restarted/);
  assert.match(text, /cannot be recovered/);
  assert.match(text, /Do NOT report this as done/);
});

test("a timed-out job names the budget it blew", () => {
  const text = wakeText({ id: "bgjob_x", to: "roby", body: "b", status: "timed_out", timeout_s: 300 });
  assert.match(text, /past its 300s budget/);
});

// ── The tool surface ────────────────────────────────────────────────────────
// `send_to_agent` is where an agent actually reaches this. The parameters are
// the whole interface a model sees, so they are asserted as an interface.
const { default: sendToAgent } = await import("#core/agent/tools/handlers/send-to-agent.js");

function handlerFor(channelMeta = {}) {
  return sendToAgent.makeHandler({
    projects: { get: () => project, resolve: () => project, list: () => [project] },
    globalConfig: {},
    channelMeta,
  });
}

test("background is opt-in, and waking is the default once you opt in", () => {
  const props = sendToAgent.schema.function.parameters.properties;
  assert.ok(props.background, "there must be a way to not wait");
  assert.ok(props.wake_me);
  // Still optional: the blocking call every existing caller makes keeps working.
  assert.deepEqual(sendToAgent.schema.function.parameters.required.sort(), ["message", "to"]);
  assert.match(props.wake_me.description, /Default TRUE/);
  // The description is the only thing that makes a model choose this, so it has
  // to say when — not merely that the option exists.
  assert.match(props.background.description, /do not need their answer/i);
  assert.match(props.wake_me.description, /context is NOT kept/i);
});

test("a background call hands the turn straight back instead of an answer", async () => {
  fresh();
  const out = await handlerFor({ agentSlug: "ansel" })({
    to: "roby", message: "knot status", background: true,
  });
  assert.equal(out.ok, true);
  assert.equal(out.status, "running");
  assert.equal(out.wake, true);
  assert.match(out.note, /do NOT wait/i);
  assert.equal(listJobs({ from: "ansel", open_only: true }).length, 1);
});

test("wake_me: false files the message and promises nothing", async () => {
  fresh();
  const out = await handlerFor({ agentSlug: "ansel" })({
    to: "roby", message: "fyi", background: true, wake_me: false,
  });
  assert.equal(out.wake, false);
  assert.match(out.note, /will NOT be woken/);
});

test("the chain is counted across turns, not restarted on every hop", async () => {
  fresh();
  // An agent answering an a2a message that is already 3 deep may not hand it on.
  const deep = await handlerFor({ agentSlug: "ansel", a2aDepth: MAX_BACKGROUND_DEPTH })({
    to: "roby", message: "and you do it", background: true,
  });
  assert.match(deep.error, /depth limit/);

  // …and the blocking path is walled too. It had no limit at all before: a
  // synchronous chain is no less a chain for being synchronous.
  const deepSync = await handlerFor({ agentSlug: "ansel", a2aDepth: MAX_BACKGROUND_DEPTH })({
    to: "roby", message: "and you do it",
  });
  assert.match(deepSync.error, /depth limit/);
  assert.equal(listJobs().length, 0);
});

test("an agent still cannot send to itself, background or not", async () => {
  fresh();
  await assert.rejects(
    handlerFor({ agentSlug: "ansel" })({ to: "ansel", message: "hi", background: true }),
    /that is you/,
  );
  assert.equal(listJobs().length, 0);
});

test("the peer's own turn knows how deep the chain is, not just the job record", async () => {
  fresh();
  const peer = recorder();
  sendInBackground({
    project, from: "ansel", to: "roby", body: "x", wake: true, depth: 2,
    messagePeerFn: peer.fn,
  });

  const sent = await until(() => peer.calls[0], "the outbound send");
  // Without this the peer ran at depth 0 and could hand the work straight on
  // again — the job record knew the depth and the turn doing the work did not.
  assert.equal(sent.depth, 2);

  const wake = await until(() => peer.calls[1], "the wake-up");
  assert.equal(wake.depth, 3, "and the wake-up counts one hop further");
});
