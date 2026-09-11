// Work left running, and the promise to wake whoever is waiting on it.
//
// The incident this store exists for (2026-09-11): Ansel finished its analysis,
// needed to tell Roby, and shelled out to `apx send … --deliver`. run_shell's
// 60 s default killed the call with SIGTERM over a message that HAD been
// delivered — so Ansel reported "sent ✅" off a failure, closed its turn, and
// never saw the reply that landed on the thread nine minutes later.
//
// Every assertion below is one of the ways that goes wrong a second time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-bgjobs-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  openJob, readJob, closeJob, claimWake, wakeClaimed, listJobs, countOpenJobs,
  deleteJob, pruneJobs, ownerAlive, jobExpired,
  BACKGROUND_JOBS_DIR, MAX_OPEN_JOBS_PER_AGENT, TERMINAL_STATUSES, DEFAULT_JOB_TIMEOUT_S,
} = await import("#core/stores/background-jobs.js");

function fresh() {
  try { fs.rmSync(BACKGROUND_JOBS_DIR, { recursive: true, force: true }); } catch { /* nothing there */ }
}

test("a job opens running, owned by this process, with a deadline", () => {
  fresh();
  const job = openJob({ project_id: 7, from: "ansel", to: "super_agent", body: "knot status", wake: true, timeout_s: 60 });

  assert.match(job.id, /^bgjob_/);
  assert.equal(job.status, "running");
  assert.equal(job.wake, true);
  // The pid is what makes recovery decidable later: alive process = running
  // job, dead process = lost job. A record without it cannot tell them apart.
  assert.equal(job.daemon_pid, process.pid);
  assert.ok(ownerAlive(job), "a job this process owns is alive by definition");
  assert.ok(!jobExpired(job), "a 60 s job is not expired the moment it opens");
  assert.ok(Date.parse(job.deadline_at) > Date.parse(job.created_at));

  assert.deepEqual(readJob(job.id), job, "it is on disk exactly as returned");
});

test("a job without a timeout still gets one", () => {
  fresh();
  const job = openJob({ from: "ansel", to: "roby" });
  assert.equal(job.timeout_s, DEFAULT_JOB_TIMEOUT_S);
  // Unbounded is what the a2a path did before this: replyAsAgent ignored the
  // budget the route advertised, so a turn ran as long as the model felt like.
  assert.ok(Number.isFinite(Date.parse(job.deadline_at)));
});

test("from and to are required — a job nobody can be woken from is not a job", () => {
  fresh();
  assert.throws(() => openJob({ from: "ansel" }), /from and to are required/);
  assert.throws(() => openJob({ to: "roby" }), /from and to are required/);
});

// ── The idempotency guarantee ───────────────────────────────────────────────
// This is THE test. Two callers can reach a finished job — the live promise
// that ran it, and the reconciler sweeping for orphans. If both wake the
// waiter, the agent does the work twice, which is a worse bug than the one
// this feature fixes.
test("exactly one caller ever wins the wake-up, no matter how many ask", () => {
  fresh();
  const job = openJob({ from: "ansel", to: "roby", wake: true });

  assert.equal(wakeClaimed(job.id), false);
  const winners = [claimWake(job.id), claimWake(job.id), claimWake(job.id), claimWake(job.id)];
  assert.deepEqual(winners, [true, false, false, false]);
  assert.equal(wakeClaimed(job.id), true);
});

test("a claim survives the job being closed — a terminal job is not re-delivered", () => {
  fresh();
  const job = openJob({ from: "ansel", to: "roby", wake: true });
  assert.equal(claimWake(job.id), true);
  closeJob(job.id, { status: "done", result: "here it is" });
  // The reconciler will meet this job again at the next boot; it must lose.
  assert.equal(claimWake(job.id), false);
});

test("claiming an id that was never a job does not crash or invent one", () => {
  fresh();
  assert.equal(claimWake("../../etc/passwd"), false, "a traversing id is refused, not written");
  assert.equal(claimWake(""), false);
  assert.equal(claimWake(null), false);
});

// ── Closing ─────────────────────────────────────────────────────────────────
test("the first outcome wins: a late success cannot overwrite a lost job", () => {
  fresh();
  const job = openJob({ from: "ansel", to: "roby" });

  const lost = closeJob(job.id, { status: "lost", result: "the daemon died holding it" });
  assert.equal(lost.status, "lost");
  assert.ok(lost.closed_at);

  // A promise nobody is holding any more must not rewrite history.
  const late = closeJob(job.id, { status: "done", result: "actually it worked!" });
  assert.equal(late.status, "lost");
  assert.equal(late.result, "the daemon died holding it");
});

test("an unknown status closes as done rather than storing a status nothing maps", () => {
  fresh();
  const job = openJob({ from: "ansel", to: "roby" });
  assert.equal(closeJob(job.id, { status: "banana" }).status, "done");
  assert.ok(TERMINAL_STATUSES.includes("done"));
});

test("closing a job that is not there returns null instead of throwing", () => {
  fresh();
  assert.equal(closeJob("bgjob_nope"), null);
  assert.equal(readJob("bgjob_nope"), null);
});

// ── The fan-out wall ────────────────────────────────────────────────────────
test("open jobs are counted per agent, and closing one frees a slot", () => {
  fresh();
  const ids = [];
  for (let i = 0; i < MAX_OPEN_JOBS_PER_AGENT; i++) {
    ids.push(openJob({ project_id: 7, from: "ansel", to: `peer${i}` }).id);
  }
  // Somebody else's jobs are not Ansel's problem.
  openJob({ project_id: 7, from: "magui", to: "roby" });

  assert.equal(countOpenJobs({ project_id: 7, from: "ansel" }), MAX_OPEN_JOBS_PER_AGENT);
  assert.equal(countOpenJobs({ project_id: 7, from: "magui" }), 1);

  closeJob(ids[0], { status: "done" });
  assert.equal(countOpenJobs({ project_id: 7, from: "ansel" }), MAX_OPEN_JOBS_PER_AGENT - 1,
    "a finished job must not hold a slot forever");
});

test("jobs are scoped by project, so one project cannot spend another's budget", () => {
  fresh();
  openJob({ project_id: 7, from: "ansel", to: "roby" });
  openJob({ project_id: 9, from: "ansel", to: "roby" });
  assert.equal(countOpenJobs({ project_id: 7, from: "ansel" }), 1);
  assert.equal(countOpenJobs({ project_id: 9, from: "ansel" }), 1);
});

// ── Recovery inputs ─────────────────────────────────────────────────────────
test("a job whose owning process is gone is not alive — the reconciler's cue", () => {
  fresh();
  const job = openJob({ from: "ansel", to: "roby" });
  // A pid that cannot be running: the kernel reserves 0, and kill(0,0) targets
  // the process group rather than a process, so the store must reject it
  // outright rather than read it as "alive".
  assert.equal(ownerAlive({ ...job, daemon_pid: 0 }), false);
  assert.equal(ownerAlive({ ...job, daemon_pid: -1 }), false);
  assert.equal(ownerAlive({ ...job, daemon_pid: 2147483646 }), false, "a pid nothing holds is dead");
  assert.equal(ownerAlive({}), false, "a record with no pid at all is not alive");
  assert.equal(ownerAlive(job), true);
});

test("a job past its deadline reads as expired", () => {
  fresh();
  const job = openJob({ from: "ansel", to: "roby", timeout_s: 1 });
  assert.equal(jobExpired(job, Date.parse(job.created_at)), false);
  assert.equal(jobExpired(job, Date.parse(job.deadline_at) + 1), true);
});

// ── Listing ─────────────────────────────────────────────────────────────────
test("listing filters by project, sender and status, newest first", () => {
  fresh();
  const a = openJob({ project_id: 7, from: "ansel", to: "roby" });
  const b = openJob({ project_id: 7, from: "ansel", to: "jaro" });
  closeJob(b.id, { status: "failed", result: "peer never answered" });

  assert.equal(listJobs({ project_id: 7 }).length, 2);
  assert.equal(listJobs({ project_id: 7, open_only: true }).length, 1);
  assert.equal(listJobs({ status: "failed" })[0].id, b.id);
  assert.equal(listJobs({ from: "nobody" }).length, 0);
  // Newest first. Asserted as the CONTRACT, not as one permutation: a and b are
  // opened in the same millisecond often enough (~1 run in 3) that pinning the
  // exact pair made this test flaky. The store sorts on created_at and breaks
  // ties on the id, which is random — so for a tie the order is stable but
  // arbitrary, and demanding [b, a] was demanding something it never promised.
  const rows = listJobs({ project_id: 7 });
  assert.deepEqual([...rows.map((j) => j.id)].sort(), [a.id, b.id].sort(), "both are listed");
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      String(rows[i - 1].created_at) >= String(rows[i].created_at),
      "descending by created_at",
    );
  }
  assert.deepEqual(
    listJobs({ project_id: 7 }).map((j) => j.id),
    rows.map((j) => j.id),
    "and two identical calls agree",
  );
});

test("a corrupt job file is skipped, not thrown — one bad file must not blind the list", () => {
  fresh();
  const good = openJob({ project_id: 7, from: "ansel", to: "roby" });
  fs.writeFileSync(path.join(BACKGROUND_JOBS_DIR, "broken.json"), "{not json");

  const jobs = listJobs({ project_id: 7 });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, good.id);
});

test("listing an empty or missing directory is an empty list, not a crash", () => {
  fresh();
  assert.deepEqual(listJobs(), []);
  assert.equal(countOpenJobs({ from: "ansel" }), 0);
});

// ── Pruning ─────────────────────────────────────────────────────────────────
test("pruning drops old terminal jobs and never touches a running one", () => {
  fresh();
  const running = openJob({ from: "ansel", to: "roby" });
  const recent = openJob({ from: "ansel", to: "jaro" });
  const old = openJob({ from: "ansel", to: "magui" });
  closeJob(recent.id, { status: "done" });
  closeJob(old.id, { status: "done" });

  // Age the closed one past the window by rewriting its stamp.
  const aged = { ...readJob(old.id), closed_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() };
  fs.writeFileSync(path.join(BACKGROUND_JOBS_DIR, `${old.id}.json`), JSON.stringify(aged));

  assert.equal(pruneJobs({ days: 7 }), 1);
  assert.equal(readJob(old.id), null);
  assert.ok(readJob(recent.id), "a job closed today is still history worth keeping");
  assert.ok(readJob(running.id), "a RUNNING job is never pruned, however old");
});

test("deleting a job takes its wake claim with it", () => {
  fresh();
  const job = openJob({ from: "ansel", to: "roby", wake: true });
  claimWake(job.id);
  deleteJob(job.id);
  assert.equal(readJob(job.id), null);
  assert.equal(wakeClaimed(job.id), false);
});
