// Stopping work an agent left running — all three halves of it.
//
// A background job exists so an agent can hand something over and carry on
// instead of holding its turn open for ten minutes. The owner could see those
// jobs and could not end them: `api/jobs.js` was read-only, and said so in its
// own header — "a cancel here would have to reach into a promise this process
// may not even own".
//
// That was true of the promise and false of the WORK. A job's work is an
// ordinary a2a turn, registered in the live-turn registry under its thread, and
// the abort hook the Stop button pulls reaches it the same way. What was
// actually missing is the third step, and it is the one that makes cancelling
// safe to offer at all:
//
//   1. the WORK stops         — or "cancel" closes a record while the peer keeps
//                               burning tokens: the panel looks right and the
//                               machine does exactly what it was told not to
//   2. the RECORD closes as `cancelled`, not `failed` — somebody decided this
//                               should not run; nothing went wrong
//   3. the WAITER is told     — an agent that asked to be woken is, by
//                               construction, sitting in NO turn. Cancel it
//                               silently and it waits for a result that is never
//                               coming, forever: the exact failure this feature
//                               was built to remove, reintroduced through its
//                               own stop button.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-bgcancel-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { openJob, readJob, BACKGROUND_JOBS_DIR, TERMINAL_STATUSES } =
  await import("#core/stores/background-jobs.js");
const { cancelJob, wakeText } = await import("#core/agent/a2a/background.js");

function fresh() {
  try { fs.rmSync(BACKGROUND_JOBS_DIR, { recursive: true, force: true }); } catch { /* nothing there */ }
}

const PROJECT = { id: 1, name: "appsi", path: "/tmp/appsi", storagePath: "/tmp/appsi-store" };

function job(extra = {}) {
  return openJob({ project_id: 1, from: "blake", to: "zoya", thread: "blake~zoya", body: "run the scorecard", wake: true, ...extra });
}

test("cancelled is a terminal status of its own, not a flavour of failed", () => {
  // An agent told "it failed" goes looking for something to fix. The two have to
  // be different words on disk before they can be different words in a prompt.
  assert.ok(TERMINAL_STATUSES.includes("cancelled"));
  assert.ok(TERMINAL_STATUSES.includes("failed"));
});

test("cancelling stops the work, closes the record and wakes the waiter", async () => {
  fresh();
  const j = job();
  const aborted = [];
  const woke = [];

  const out = await cancelJob(j.id, {
    abortFn: (rec) => { aborted.push(rec.id); return true; },
    project: PROJECT,
    messagePeerFn: async (args) => { woke.push(args); return { text: "" }; },
  });

  assert.equal(out.ok, true);
  assert.equal(out.stopped, true, "the running turn was actually reached");
  assert.deepEqual(aborted, [j.id]);
  assert.equal(readJob(j.id).status, "cancelled");
  assert.equal(out.woken, true, "the agent waiting on it was told");

  // The wake-up goes back down the SAME thread, from the worker to the waiter —
  // reversed, so it reads as the reply to the request it answers.
  assert.equal(woke.length, 1);
  assert.equal(woke[0].from, "zoya");
  assert.equal(woke[0].to, "blake");
  assert.match(woke[0].body, /CANCELLED/);
});

test("what the woken agent is told is not a failure and not a retry", async () => {
  fresh();
  const j = job();
  await cancelJob(j.id, { project: PROJECT, messagePeerFn: async () => ({ text: "" }) });
  const text = wakeText(readJob(j.id));

  assert.match(text, /CANCELLED/);
  assert.match(text, /nothing went wrong/i, "it is not an error to be diagnosed");
  assert.match(text, /Do NOT start it again/i, "restarting overrules the person who stopped it");
  assert.match(text, /do NOT report it as done/i);
  // And it still carries what was asked, so the agent knows WHICH of its jobs
  // this was — it may have three open.
  assert.match(text, /run the scorecard/);
  // The failure wording must not leak in: "retry" is exactly what this one
  // must not suggest.
  assert.doesNotMatch(text, /whether to retry/i);
});

test("a job whose turn is not running here still cancels", async () => {
  // The daemon restarted, or the peer is a detached runtime. The RECORD is what
  // the waiter is waiting on, so closing it is the part that must not depend on
  // reaching a promise.
  fresh();
  const j = job();
  const out = await cancelJob(j.id, {
    abortFn: () => false,
    project: PROJECT,
    messagePeerFn: async () => ({ text: "" }),
  });
  assert.equal(out.ok, true);
  assert.equal(out.stopped, false, "and it says so, rather than claiming it stopped something");
  assert.equal(readJob(j.id).status, "cancelled");
  assert.match(readJob(j.id).result, /no longer running/);
});

test("an abort hook that throws does not stop the cancel", async () => {
  fresh();
  const j = job();
  const out = await cancelJob(j.id, {
    abortFn: () => { throw new Error("registry is gone"); },
    project: PROJECT,
    messagePeerFn: async () => ({ text: "" }),
  });
  assert.equal(out.ok, true);
  assert.equal(readJob(j.id).status, "cancelled");
});

test("a job that asked for no wake-up is closed quietly", async () => {
  fresh();
  const j = job({ wake: false });
  const woke = [];
  const out = await cancelJob(j.id, {
    project: PROJECT,
    messagePeerFn: async (a) => { woke.push(a); return { text: "" }; },
  });
  assert.equal(out.ok, true);
  assert.equal(out.woken, false);
  assert.equal(woke.length, 0, "nobody asked to be woken, so nobody is");
});

test("a job that already ended cannot be cancelled twice", async () => {
  fresh();
  const j = job();
  await cancelJob(j.id, { project: PROJECT, messagePeerFn: async () => ({ text: "" }) });

  const woke = [];
  const again = await cancelJob(j.id, {
    project: PROJECT,
    messagePeerFn: async (a) => { woke.push(a); return { text: "" }; },
  });
  assert.equal(again.ok, false);
  assert.match(again.reason, /already cancelled/);
  assert.equal(woke.length, 0, "waking an agent twice makes it do the work twice");
});

test("cancelling something that is not there says so", async () => {
  fresh();
  const out = await cancelJob("job_nope", { project: PROJECT });
  assert.equal(out.ok, false);
  assert.match(out.reason, /no such job/);
});

test("the route reaches the same turn the thread's own Stop does", () => {
  // Keyed by (project, "a2a", thread) — one key, so the two buttons cannot end
  // up addressing two different ideas of the same run.
  const src = fs.readFileSync(new URL("../src/host/daemon/api/jobs.js", import.meta.url), "utf8");
  assert.match(src, /abortFn: \(j\) => abortActiveTurn\(threadTurnKey\(j\.project_id, "a2a", j\.thread\)\)/);
  // A job that already ended answers 409, not 200: a panel that greys the row
  // out on an optimistic success lies about one that finished a second before
  // the click.
  assert.match(src, /res\.status\(409\)\.json\(\{ error: `job already \$\{job\.status\}`/);
});

test("every agent is told this mechanism exists", () => {
  // The mechanics have to be in the prompt every agent gets, not only in the
  // tool schema of the one tool that starts a job — an agent that does not know
  // it can hand work over holds its turn open for ten minutes instead.
  const base = fs.readFileSync(new URL("../src/core/agent/prompts/core/agent-base.md", import.meta.url), "utf8");
  assert.match(base, /# Leaving work running/);
  assert.match(base, /background: true/, "how to start one");
  assert.match(base, /woken as a NEW turn/i, "that it comes back on its own");
  assert.match(base, /context is not kept/i, "and what that costs");
  assert.match(base, /cancelled/i, "that the owner can stop it");
  assert.match(base, /Do not start it again|Do NOT start it again/, "and what that means");
  assert.match(base, /apx send --deliver/, "and the shell trap that produced all this");
});
