// Bringing the agent back when the command it left running ends.
//
// Leaving work running is only half a mechanism. The half that makes it worth
// having is the return: an agent that launches thirteen renders and is never
// told they finished has not deferred the work, it has abandoned it — and the
// owner is left reading a chat where somebody said "ya lo lanzo" and then went
// quiet forever.
//
// The a2a half of this is delivered as a message from the peer. A command has no
// peer, so the wake-up goes back to the CHAT the job was launched from, which is
// where the person waiting for those reels is sitting.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-shellwake-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { makeTempProject } = await import("./_helpers.js");
const { openJob, closeJob, readJob, wakeClaimed, BACKGROUND_JOBS_DIR } =
  await import("#core/stores/background-jobs.js");
const { runShellInBackground } = await import("#core/agent/shell/background.js");
const { emitBackgroundJobEvent } = await import("#core/events/bus.js");
const { wakeShellJob, startShellJobWake } = await import("#host/daemon/shell-job-wake.js");

const ROOT = makeTempProject({
  name: "tecnomanu",
  agents: [{ slug: "reels", model: "openai:test-model", description: "hace reels" }],
});
const PROJECT = { id: 7, name: "tecnomanu", path: ROOT, storagePath: path.join(TMP_HOME, "store"), config: {} };
fs.mkdirSync(PROJECT.storagePath, { recursive: true });
const PROJECTS = { get: () => PROJECT, list: () => [PROJECT], rebuild: () => {} };

function fresh() {
  try { fs.rmSync(BACKGROUND_JOBS_DIR, { recursive: true, force: true }); } catch { /* nothing there */ }
}

/** A stand-in for the turn, recording what it was asked to run. */
function spyTurn() {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    return { conversation_id: args.conversationId || "new-conv", text: "listo", result: {} };
  };
  return [calls, fn];
}

function finishedJob({ wake = true, origin = { channel: "web", conversation_id: "web-main" } } = {}) {
  const job = openJob({
    project_id: PROJECT.id, kind: "shell", from: "reels",
    command: "hyperframes render reel-13", cwd: ROOT, body: "hyperframes render reel-13",
    wake, origin,
  });
  return closeJob(job.id, { status: "done", result: "exit 0", exit_code: 0 });
}

test("the agent is woken in the chat it left the job from", async () => {
  fresh();
  const job = finishedJob();
  const [calls, runChatTurnFn] = spyTurn();

  const out = await wakeShellJob(job, { projects: PROJECTS, runChatTurnFn });
  assert.equal(out.woken, true);
  assert.equal(calls.length, 1);

  const call = calls[0];
  assert.equal(call.agent.slug, "reels", "the agent that left it running, not another");
  // THE ADDRESS. Without it the result is real and lands nowhere anybody reads.
  assert.equal(call.conversationId, "web-main");
  assert.equal(call.channel, "web");
  // What it is woken WITH: the command it ran and how that ended, because its
  // context from twenty minutes ago is gone.
  assert.match(call.prompt, /hyperframes render reel-13/);
  assert.match(call.prompt, /exited 0/);
  assert.match(call.prompt, /Pick up where you left off/i);
  // Nobody typed this. The thread should say so on the record.
  assert.equal(call.promptMeta.automation, "background_job");
  // The outcome rides as fields, not only inside the prose the model reads: the
  // chat draws its notice from these, and re-parsing "it exited 127" out of a
  // paragraph is a thing that works until the paragraph is reworded.
  assert.equal(call.promptMeta.job.id, job.id);
  assert.equal(call.promptMeta.job.status, "done");
  assert.equal(call.promptMeta.job.exit_code, 0);
  assert.match(call.promptMeta.job.command, /hyperframes render reel-13/);
});

test("woken exactly once, however many things notice it ended", async () => {
  fresh();
  const job = finishedJob();
  const [calls, runChatTurnFn] = spyTurn();

  const first = await wakeShellJob(job, { projects: PROJECTS, runChatTurnFn });
  const second = await wakeShellJob(job, { projects: PROJECTS, runChatTurnFn });

  assert.equal(first.woken, true);
  assert.equal(second.woken, false);
  assert.match(second.reason, /already delivered/);
  // The reconciler and the live path can both reach a finished job. An agent
  // woken twice by one result does the work twice — which is worse than the
  // silence this replaces.
  assert.equal(calls.length, 1);
  assert.equal(wakeClaimed(job.id), true);
});

test("a command ending wakes the agent through the event, not through a call", async () => {
  fresh();
  let resolve;
  const arrived = new Promise((r) => { resolve = r; });
  const calls = [];
  const runChatTurnFn = async (args) => {
    calls.push(args);
    resolve(args);
    return { conversation_id: args.conversationId, text: "ok", result: {} };
  };
  const sub = startShellJobWake({ projects: PROJECTS, runChatTurnFn, log: () => {} });
  try {
    // The whole path: a real process, its real exit, the frame every other
    // surface already draws from, and the turn at the end of it.
    const out = runShellInBackground({
      project: PROJECT, from: "reels", command: "echo rendered; exit 0", cwd: ROOT,
      origin: { channel: "web", conversation_id: "web-main" },
    });
    const call = await arrived;
    assert.match(call.prompt, /echo rendered/);
    assert.match(call.prompt, /exited 0/);
    assert.equal(call.conversationId, "web-main");
    assert.equal(readJob(out.job_id).status, "done");
  } finally {
    sub.stop();
  }
});

test("a job that asked for no wake-up is left alone", async () => {
  fresh();
  const calls = [];
  const sub = startShellJobWake({
    projects: PROJECTS,
    runChatTurnFn: async (a) => { calls.push(a); return { conversation_id: "x", text: "", result: {} }; },
    log: () => {},
  });
  try {
    const job = finishedJob({ wake: false });
    emitBackgroundJobEvent({ phase: "end", job });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 0);
    assert.equal(wakeClaimed(job.id), false, "and nothing claimed it on the way past");
  } finally {
    sub.stop();
  }
});

test("an a2a job is not this listener's business", async () => {
  fresh();
  const calls = [];
  const sub = startShellJobWake({
    projects: PROJECTS,
    runChatTurnFn: async (a) => { calls.push(a); return { conversation_id: "x", text: "", result: {} }; },
    log: () => {},
  });
  try {
    const job = openJob({ project_id: PROJECT.id, from: "reels", to: "magui", body: "¿cómo va?", wake: true });
    emitBackgroundJobEvent({ phase: "end", job: closeJob(job.id, { status: "done", result: "bien" }) });
    await new Promise((r) => setTimeout(r, 50));
    // Those are woken as a message from the peer (a2a/background.js). Two
    // mechanisms reaching one job is how an agent gets woken twice.
    assert.equal(calls.length, 0);
    assert.equal(wakeClaimed(job.id), false);
  } finally {
    sub.stop();
  }
});

test("an agent that no longer exists is reported, not thrown", async () => {
  fresh();
  const job = openJob({
    project_id: PROJECT.id, kind: "shell", from: "ghost", command: "true", wake: true,
    origin: { channel: "web", conversation_id: "web-main" },
  });
  const settled = closeJob(job.id, { status: "done", result: "exit 0", exit_code: 0 });
  const [calls, runChatTurnFn] = spyTurn();
  const logged = [];

  const out = await wakeShellJob(settled, { projects: PROJECTS, runChatTurnFn, log: (m) => logged.push(m) });
  assert.equal(out.woken, false);
  assert.match(out.reason, /agent gone/);
  assert.equal(calls.length, 0);
  assert.match(logged.join("\n"), /no such agent/);
  // Not claimed: nothing was delivered, so nothing may pretend it was.
  assert.equal(wakeClaimed(settled.id), false);
});

test("a turn that blows up loses the nudge, not the record", async () => {
  fresh();
  const job = finishedJob();
  const logged = [];
  const out = await wakeShellJob(job, {
    projects: PROJECTS,
    runChatTurnFn: async () => { throw new Error("engine down"); },
    log: (m) => logged.push(m),
  });
  assert.equal(out.woken, false);
  assert.match(out.reason, /engine down/);
  assert.match(logged.join("\n"), /wake for .* failed/);
  // The outcome is still on disk for the panel and for whoever looks later.
  assert.equal(readJob(job.id).status, "done");
});
