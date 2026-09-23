// A command an agent left running.
//
// The failure this replaces, seen 2026-09-14: an agent asked to render thirteen
// reels had no way to run anything that takes minutes. `run_shell` waits, and is
// killed at 600 s at the very most — so the agent either held its turn open in
// silence or reported whatever a SIGTERM left in the buffer, and the owner
// watching the chat saw neither work nor an explanation: "no te veo ejecutar
// tools que estén haciendo reels".
//
// Every assertion below is one of the ways that goes wrong a second time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-shelljobs-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  readJob, listJobs, deleteJob, wakeClaimed, jobKind, jobLogPath,
  BACKGROUND_JOBS_DIR, MAX_OPEN_JOBS_PER_AGENT,
} = await import("#core/stores/background-jobs.js");
const { runShellInBackground, killShellJob, shellWakeText } =
  await import("#core/agent/shell/background.js");
const { deliverWake } = await import("#core/agent/a2a/background.js");
const { onBackgroundJobEvent } = await import("#core/events/bus.js");
const { default: runShell } = await import("#core/agent/tools/handlers/run-shell.js");

const PROJECT = { id: 7, name: "tecnomanu", path: TMP_HOME, storagePath: TMP_HOME, config: {} };

function fresh() {
  try { fs.rmSync(BACKGROUND_JOBS_DIR, { recursive: true, force: true }); } catch { /* nothing there */ }
}

/** Resolve when this job ends, however it ends. */
function ended(jobId, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`job ${jobId} never ended`)); }, timeoutMs);
    const off = onBackgroundJobEvent((ev) => {
      if (ev?.phase !== "end" || ev.job?.id !== jobId) return;
      clearTimeout(timer);
      off();
      resolve(ev.job);
    });
  });
}

/** Resolve on the first progress frame carrying output. */
function printedSomething(jobId, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`job ${jobId} printed nothing`)); }, timeoutMs);
    const off = onBackgroundJobEvent((ev) => {
      if (ev?.job?.id !== jobId || !String(ev.job.tail || "").trim()) return;
      clearTimeout(timer);
      off();
      resolve(ev.job);
    });
  });
}

test("a long command is launched and the turn is handed straight back", async () => {
  fresh();
  const out = runShellInBackground({
    project: PROJECT, from: "reels", command: "sleep 0.2; echo rendered", cwd: TMP_HOME,
  });
  assert.equal(out.ok, true);
  assert.match(out.job_id, /^bgjob_/);
  assert.equal(out.status, "running");
  assert.ok(out.pid > 0, "the process is already running when we answer");
  // The note is the model's instruction, and the one thing it must not do is
  // wait or poll — that is the blocking this exists to remove, paid for twice.
  assert.match(out.note, /do NOT wait|Do NOT wait/i);
  assert.match(out.note, /woken in this chat/i);

  const job = readJob(out.job_id);
  assert.equal(jobKind(job), "shell");
  assert.equal(job.status, "running");
  assert.equal(job.command, "sleep 0.2; echo rendered");
  assert.equal(job.to, null, "a process is not somebody you can address");
  assert.equal(job.body, job.command, "the panel has something to show");

  await ended(out.job_id);
});

test("what it prints lands on the record while it is still running", async () => {
  fresh();
  const out = runShellInBackground({
    project: PROJECT, from: "reels", command: "echo frame 412/900; sleep 0.4", cwd: TMP_HOME,
  });
  // The whole of "so we can see how it is going": the tail moves BEFORE the
  // command is over, or the panel is a spinner with a command written under it.
  const mid = await printedSomething(out.job_id);
  assert.match(mid.tail, /frame 412\/900/);
  assert.equal(mid.status, "running", "and it is still running when we see it");

  const done = await ended(out.job_id);
  assert.equal(done.status, "done");
  // The full output outlives the tail, for anything longer than the record holds.
  assert.match(fs.readFileSync(jobLogPath(out.job_id), "utf8"), /frame 412\/900/);
});

test("exit 0 closes it done, with the code on the record", async () => {
  fresh();
  const out = runShellInBackground({ project: PROJECT, from: "reels", command: "true", cwd: TMP_HOME });
  const job = await ended(out.job_id);
  assert.equal(job.status, "done");
  assert.equal(job.exit_code, 0);
  assert.match(shellWakeText(job), /exited 0/);
  assert.match(shellWakeText(job), /Pick up where you left off/i);
});

test("a command that fails is FAILED, and the wake-up cannot be read as success", async () => {
  fresh();
  const out = runShellInBackground({
    project: PROJECT, from: "reels", command: "echo no such file >&2; exit 3", cwd: TMP_HOME,
  });
  const job = await ended(out.job_id);
  assert.equal(job.status, "failed");
  assert.equal(job.exit_code, 3);

  const text = shellWakeText(job);
  // The incident that produced the whole background-job store ended with an
  // agent reporting "sent ✅" off a timeout. A failure has to SAY it failed, in
  // the same sentence as what to do about it.
  assert.match(text, /did NOT finish cleanly/);
  assert.match(text, /it exited 3/);
  assert.match(text, /Do NOT report this as done/);
  assert.match(text, /no such file/, "and hand back what the command actually said");
});

test("a daemon restart does not become 'the work is gone'", () => {
  // A detached child outlives the daemon: the reconciler closes the RECORD as
  // lost because we stopped watching, and an agent told "it is gone" would redo
  // work that may be sitting finished on disk.
  const text = shellWakeText({
    id: "bgjob_x", status: "lost", command: "hyperframes render", timeout_s: 3600,
  });
  assert.match(text, /stopped watching/i);
  assert.match(text, /may have kept going/i);
  assert.match(text, /files on disk are the truth/i);
});

test("three open jobs is the wall, and the refusal says what to do instead", async () => {
  fresh();
  const open = [];
  for (let i = 0; i < MAX_OPEN_JOBS_PER_AGENT; i++) {
    const out = runShellInBackground({
      project: PROJECT, from: "reels", command: "sleep 5", cwd: TMP_HOME,
    });
    assert.equal(out.ok, true, `job ${i + 1} should be allowed`);
    open.push(out);
  }
  const refused = runShellInBackground({
    project: PROJECT, from: "reels", command: "sleep 5", cwd: TMP_HOME,
  });
  assert.ok(refused.error, "the fourth is refused");
  assert.match(refused.error, /limit 3/);
  // Refused, and told what to do about it — a wall a model cannot read is a
  // wall it retries against.
  assert.match(refused.error, /Wait for one to finish/i);
  // The wall is per agent, not global: somebody else is not blocked by this.
  const other = runShellInBackground({
    project: PROJECT, from: "magui", command: "true", cwd: TMP_HOME,
  });
  assert.equal(other.ok, true);

  for (const job of open) killShellJob(readJob(job.job_id));
  await Promise.all(open.map((j) => ended(j.job_id)));
  await ended(other.job_id).catch(() => { /* it may have ended before we listened */ });
});

test("stopping it kills the whole tree, not just the shell that spawned it", async () => {
  fresh();
  // A backgrounded grandchild is exactly what a render is: kill `sh -lc` alone
  // and ffmpeg keeps running, the panel says stopped and the fans say otherwise.
  const out = runShellInBackground({
    project: PROJECT, from: "reels", command: "sleep 5 & echo pid=$!; wait", cwd: TMP_HOME,
  });
  const printed = await printedSomething(out.job_id);
  const grandchild = Number(/pid=(\d+)/.exec(printed.tail)?.[1]);
  assert.ok(grandchild > 0, "the grandchild announced itself");
  assert.doesNotThrow(() => process.kill(grandchild, 0), "it is alive to begin with");

  assert.equal(killShellJob(readJob(out.job_id)), true);
  await ended(out.job_id);
  // Give the signal a moment to be delivered to the whole group.
  await new Promise((r) => setTimeout(r, 200));
  assert.throws(() => process.kill(grandchild, 0), "the grandchild went with it");
});

test("a shell job is never woken as an a2a message", async () => {
  fresh();
  const out = runShellInBackground({
    project: PROJECT, from: "reels", command: "true", cwd: TMP_HOME, wake: true,
  });
  const job = await ended(out.job_id);

  // deliverWake writes AS THE PEER (`from: job.to`), and a shell job has none —
  // delivering it that way would file a message from an agent that does not
  // exist. Refused BEFORE the claim, or the wake-up that CAN be delivered (the
  // daemon's shell-job-wake.js) would find it already taken.
  const res = await deliverWake(job, { project: PROJECT });
  assert.equal(res.delivered, false);
  assert.match(res.reason, /not an a2a job/);
  assert.equal(wakeClaimed(job.id), false, "and the wake-up is still there to be delivered");
});

test("the tool records which chat to come back to", async () => {
  fresh();
  const ctx = {
    projects: { list: () => [PROJECT], get: () => PROJECT },
    requirePermission: async () => {},
    channel: "web",
    channelMeta: { agentSlug: "reels", conversation_id: "web-main", projectPath: TMP_HOME },
  };
  const out = await runShell.makeHandler(ctx)({
    command: "true", background: true, project: "tecnomanu",
  });
  assert.equal(out.ok, true);
  const job = readJob(out.job_id);
  assert.equal(job.from, "reels", "the waiter is the agent whose turn this is");
  assert.equal(job.wake, true);
  // Without this the wake-up has a result and nowhere to report it.
  assert.deepEqual(job.origin, { channel: "web", conversation_id: "web-main" });
  await ended(out.job_id);
});

test("the super-agent is told plainly that nothing will wake it", async () => {
  fresh();
  const ctx = {
    projects: { list: () => [PROJECT], get: () => PROJECT },
    requirePermission: async () => {},
    channel: "telegram",
    channelMeta: {},           // no agentSlug → the super-agent's own turn
  };
  const out = await runShell.makeHandler(ctx)({ command: "true", background: true });
  assert.equal(out.ok, true);
  assert.equal(out.wake, false);
  // Promising a wake-up that never comes is the failure this whole feature was
  // built to remove. Saying so at the point of use is the honest alternative.
  assert.match(out.note, /NOBODY WILL WAKE YOU/);
  assert.equal(readJob(out.job_id).wake, false);
  await ended(out.job_id);
});

test("a command that cannot start fails the job instead of throwing", async () => {
  fresh();
  const out = runShellInBackground({
    project: PROJECT, from: "reels", command: "true", cwd: path.join(TMP_HOME, "nope"),
  });
  // spawn rejects a cwd that does not exist. Either arm is acceptable — what is
  // not is an exception reaching the model, or a job left running forever.
  if (out.error) {
    assert.match(out.error, /could not start/i);
  } else {
    const job = await ended(out.job_id);
    assert.equal(job.status, "failed");
  }
  assert.equal(listJobs({ open_only: true }).length, 0, "nothing is left open");
});

test("the store cleans up after itself", () => {
  fresh();
  const out = runShellInBackground({ project: PROJECT, from: "reels", command: "true", cwd: TMP_HOME });
  const log = jobLogPath(out.job_id);
  deleteJob(out.job_id);
  assert.equal(readJob(out.job_id), null);
  assert.equal(fs.existsSync(log), false, "the log goes with the record it belongs to");
});

// An agent inside an a2a exchange that shells out `apx send … --deliver`
// opened an exchange the daemon could not tie to the one it was in: the CLI
// always sent depth 0, so the chain restarted and the depth wall never held on
// that path. run_shell hands the depth to the shell; `apx send` sends it back.
test("a foreground command inside an a2a turn sees the chain depth", async () => {
  const ctx = {
    projects: { list: () => [PROJECT], get: () => PROJECT },
    requirePermission: async () => {},
    channel: "a2a",
    channelMeta: { agentSlug: "reels", a2aDepth: 2, projectPath: TMP_HOME },
  };
  const out = await runShell.makeHandler(ctx)({ command: 'printf "%s" "$APX_A2A_DEPTH"', project: "tecnomanu" });
  assert.equal(String(out.stdout).trim(), "2");
  const outside = await runShell.makeHandler({ ...ctx, channel: "web", channelMeta: { agentSlug: "reels" } })({
    command: 'printf "[%s]" "$APX_A2A_DEPTH"', project: "tecnomanu",
  });
  assert.equal(String(outside.stdout).trim(), "[]", "outside an exchange there is no chain to count");
  const cli = fs.readFileSync(new URL("../src/interfaces/cli/commands/a2a.js", import.meta.url), "utf8");
  assert.match(cli, /_depth: Number\(process\.env\.APX_A2A_DEPTH\)/, "and `apx send` sends it back as _depth");
});
