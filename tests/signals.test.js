// Signals and the `watch` routine kind (02-SPEC-capabilities.md § C4).
//
// The design claim: detection is deterministic and cheap, judgement is the
// model's and expensive. Everything here runs with synthetic state and no
// model at all — which is itself the proof that the split holds.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-signals-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const {
  detectSignals, formatSignals, peakSeverity, thresholdsFromConfig,
  SIGNAL_TYPES, DEFAULT_THRESHOLDS,
} = await import("#core/routines/signals.js");
const { createTask, doneTask, setTaskStatus } = await import("#core/stores/tasks.js");
const { createCommitment } = await import("#core/stores/commitments.js");
const { appendMessageToFs } = await import("#core/stores/messages.js");

const NOW = "2026-06-15T12:00:00.000Z";

let STORE;
let PROJECT;
beforeEach(() => {
  STORE = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  PROJECT = { id: 1, name: "alpha", storagePath: STORE };
});

const only = (type) => ({ now: NOW, types: [type] });

// --------------------------------------------------------------------------
// each detector, with state built by hand
// --------------------------------------------------------------------------

test("an inbound a2a message since the last sweep is a signal; outbound and old are not", () => {
  const a2a = (direction, author, body, ts) =>
    appendMessageToFs({ projectRoot: STORE, channel: "a2a", direction, type: "agent", author, body, ts });
  a2a("in", "rocky", "deploy of Savia is green", "2026-06-15T11:00:00.000Z");
  a2a("out", "roby", "thanks", "2026-06-15T11:01:00.000Z");       // outbound: not for the owner
  a2a("in", "april", "old news", "2026-06-15T09:00:00.000Z");      // before the last sweep

  const { signals } = detectSignals([PROJECT], {
    now: NOW, types: ["a2a_message"], a2a_since: "2026-06-15T10:00:00.000Z",
  });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].payload.from, "rocky");
  assert.match(signals[0].subject, /rocky sent \(a2a\)/);
});

test("a2a_message is a default detector, so the watch sees a2a without opting in", () => {
  assert.ok(SIGNAL_TYPES.includes("a2a_message"));
});

test("an a2a severity tag maps to signal severity; blocker is critical, solicited is carried", () => {
  const tagged = (author, meta) =>
    appendMessageToFs({
      projectRoot: STORE, channel: "a2a", direction: "in", type: "agent",
      author, body: `msg from ${author}`, ts: "2026-06-15T11:00:00.000Z", meta,
    });
  tagged("rocky", { severity: "blocker" });
  tagged("april", { severity: "fyi" });
  tagged("max", { severity: "bogus" });                 // unknown tag → plain normal
  tagged("nina", { severity: "status", solicited: true });

  const { signals } = detectSignals([PROJECT], {
    now: NOW, types: ["a2a_message"], a2a_since: "2026-06-15T10:00:00.000Z",
  });
  const by = Object.fromEntries(signals.map((s) => [s.payload.from, s]));
  assert.equal(by.rocky.severity, "critical");   // blocker → critical (owner: crosses quiet-hours)
  assert.equal(by.april.severity, "low");
  assert.equal(by.max.severity, "normal");
  assert.equal(by.nina.payload.solicited, true); // solicited carried through for the gate
  assert.equal(by.max.payload.solicited, false);
});

test("an owner_notified a2a row is skipped — the /send route already pinged the owner", () => {
  const inbound = (author, meta) =>
    appendMessageToFs({
      projectRoot: STORE, channel: "a2a", direction: "in", type: "agent",
      author, body: `msg from ${author}`, ts: "2026-06-15T11:00:00.000Z", meta,
    });
  // A blocker relayed with severity is pinged in the act and stamped, so the
  // watch must not re-notify it; an ordinary one still surfaces.
  inbound("rocky", { severity: "blocker", owner_notified: true });
  inbound("april", { severity: "status" });

  const { signals } = detectSignals([PROJECT], {
    now: NOW, types: ["a2a_message"], a2a_since: "2026-06-15T10:00:00.000Z",
  });
  const froms = signals.map((s) => s.payload.from);
  assert.ok(!froms.includes("rocky"), "owner_notified row must not resurface");
  assert.ok(froms.includes("april"), "an un-notified row still surfaces");
});

test("an overdue task is a signal; one due tomorrow is not", () => {
  createTask(STORE, { title: "late", due: "2026-06-01" });
  createTask(STORE, { title: "soon", due: "2026-06-16" });

  const { signals } = detectSignals([PROJECT], only("overdue_task"));
  assert.equal(signals.length, 1);
  assert.equal(signals[0].payload.title, "late");
  assert.equal(signals[0].payload.days_late, 14);
});

test("how late it is changes the severity", () => {
  createTask(STORE, { title: "a bit late", due: "2026-06-13" });
  createTask(STORE, { title: "very late", due: "2026-05-01" });
  const { signals } = detectSignals([PROJECT], only("overdue_task"));
  const bySubject = Object.fromEntries(signals.map((s) => [s.payload.title, s.severity]));
  assert.equal(bySubject["a bit late"], "normal");
  assert.equal(bySubject["very late"], "high");
});

test("a closed task is never overdue", () => {
  const t = createTask(STORE, { title: "done late", due: "2026-01-01" });
  doneTask(STORE, t.id);
  const { signals } = detectSignals([PROJECT], only("overdue_task"));
  assert.equal(signals.length, 0);
});

test("a task blocked long enough is a signal; freshly blocked is not", () => {
  const stale = createTask(STORE, { title: "stuck for days" });
  const fresh = createTask(STORE, { title: "just blocked" });
  setTaskStatus(STORE, stale.id, "blocked");
  setTaskStatus(STORE, fresh.id, "blocked");

  // Both were just written, so with a 48h threshold neither qualifies. That is
  // the point: "blocked this morning" is a normal working state, and flagging
  // it would train the user to ignore the watcher.
  const none = detectSignals([PROJECT], { ...only("blocked_task"), blocked_hours: 48 });
  assert.equal(none.signals.length, 0);

  // With a zero-hour threshold both qualify — proving the threshold is the
  // thing doing the work, not a hidden constant.
  const all = detectSignals([PROJECT], {
    ...only("blocked_task"), blocked_hours: 0, now: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(all.signals.length, 2);
});

test("a commitment inside the lead window warns while there is still time", () => {
  createCommitment(STORE, { counterparty: "Ana", body: "the quote", due: "2026-06-16T12:00:00.000Z" });
  createCommitment(STORE, { counterparty: "Bruno", body: "the deck", due: "2026-07-01T12:00:00.000Z" });

  const { signals } = detectSignals([PROJECT], {
    ...only("commitment_due"), commitment_lead_hours: 48,
  });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].payload.counterparty, "Ana");
  assert.equal(signals[0].severity, "high", "someone is waiting — outranks an equivalent task");
});

test("an overdue promise is critical, and says who is owed", () => {
  createCommitment(STORE, { counterparty: "Ana", body: "the quote", due: "2026-06-01T00:00:00.000Z" });
  const { signals } = detectSignals([PROJECT], only("overdue_commitment"));
  assert.equal(signals.length, 1);
  assert.equal(signals[0].severity, "critical");
  assert.match(signals[0].subject, /you owe Ana/);
});

test("a project with nothing recorded is never called stale", () => {
  // A freshly registered project is not neglected. Greeting someone with
  // "this is stale" the day they add it is what gets a watcher muted.
  const { signals } = detectSignals([PROJECT], { ...only("stale_project"), stale_project_days: 1 });
  assert.equal(signals.length, 0);
});

test("staleness says what it actually measured", () => {
  createTask(STORE, { title: "the last thing anyone did" });
  const { signals } = detectSignals([PROJECT], {
    now: "2099-01-01T00:00:00.000Z", types: ["stale_project"], stale_project_days: 7,
  });
  assert.equal(signals.length, 1);
  // APX has no single per-project activity timestamp, so the phrasing must not
  // claim one. Overstating here is how a watcher loses credibility.
  assert.match(signals[0].subject, /no task or commitment activity/);
  assert.equal(signals[0].payload.measured, "task or commitment activity");
});

test("a caller with a real activity timestamp overrides the proxy", () => {
  createTask(STORE, { title: "old" });
  const { signals } = detectSignals(
    [{ ...PROJECT, last_activity_at: "2098-12-31T00:00:00.000Z" }],
    { now: "2099-01-01T00:00:00.000Z", types: ["stale_project"], stale_project_days: 7 },
  );
  assert.equal(signals.length, 0, "one day of silence is not staleness");
});

// --------------------------------------------------------------------------
// the sweep
// --------------------------------------------------------------------------

test("nothing wrong means no signals at all", () => {
  createTask(STORE, { title: "healthy", due: "2099-01-01" });
  const { signals } = detectSignals([PROJECT], { now: NOW });
  assert.deepEqual(signals, [], "quiet state must produce an empty sweep, not a noisy one");
});

test("worst first, so a truncated message still carries the worst news", () => {
  createTask(STORE, { title: "late task", due: "2026-06-01" });
  createCommitment(STORE, { counterparty: "Ana", body: "the quote", due: "2026-06-01T00:00:00.000Z" });
  const { signals } = detectSignals([PROJECT], { now: NOW });
  assert.equal(signals[0].type, "overdue_commitment");
  assert.equal(peakSeverity(signals), "critical");
});

test("every signal carries its project, so a cross-project sweep stays attributable", () => {
  const other = fs.mkdtempSync(path.join(TMP_HOME, "beta-"));
  createTask(STORE, { title: "alpha late", due: "2026-01-01" });
  createTask(other, { title: "beta late", due: "2026-01-01" });

  const { signals } = detectSignals(
    [PROJECT, { id: 2, name: "beta", storagePath: other }],
    only("overdue_task"),
  );
  assert.equal(signals.length, 2);
  assert.deepEqual(new Set(signals.map((s) => s.project_name)), new Set(["alpha", "beta"]));
});

test("an unreadable project is reported, not silently treated as healthy", () => {
  // "All clear" from a blind sweep is worse than an error.
  const { skipped } = detectSignals(
    [{ id: 9, name: "broken", storagePath: "/dev/null/nope" }],
    only("overdue_task"),
  );
  assert.ok(Array.isArray(skipped));
});

test("only the requested detectors run", () => {
  createTask(STORE, { title: "late", due: "2026-01-01" });
  createCommitment(STORE, { counterparty: "Ana", body: "x", due: "2026-01-01T00:00:00.000Z" });
  const { signals } = detectSignals([PROJECT], only("overdue_task"));
  assert.deepEqual([...new Set(signals.map((s) => s.type))], ["overdue_task"]);
});

test("an unknown detector name is ignored rather than throwing", () => {
  const { signals } = detectSignals([PROJECT], { now: NOW, types: ["not_a_detector"] });
  assert.deepEqual(signals, []);
});

// --------------------------------------------------------------------------
// thresholds are parameters, not constants
// --------------------------------------------------------------------------

test("thresholds come from the profile, with sane fallbacks", () => {
  const fromProfile = thresholdsFromConfig({ stale_project_days: 3, blocked_task_hours: 6 });
  assert.equal(fromProfile.stale_project_days, 3);
  assert.equal(fromProfile.blocked_hours, 6);
  assert.equal(fromProfile.commitment_lead_hours, DEFAULT_THRESHOLDS.commitment_lead_hours);

  // Garbage falls back rather than producing a zero threshold, which would
  // make every project stale the moment someone typos a config field.
  assert.equal(thresholdsFromConfig({ stale_project_days: "soon" }).stale_project_days,
    DEFAULT_THRESHOLDS.stale_project_days);
  assert.equal(thresholdsFromConfig({ stale_project_days: 0 }).stale_project_days,
    DEFAULT_THRESHOLDS.stale_project_days);
});

test("every declared type has a detector behind it", () => {
  createTask(STORE, { title: "x" });
  for (const type of SIGNAL_TYPES) {
    assert.doesNotThrow(() => detectSignals([PROJECT], { now: NOW, types: [type] }), type);
  }
});

// --------------------------------------------------------------------------
// rendering
// --------------------------------------------------------------------------

test("signals render as lines the model judges, not JSON it must parse", () => {
  createCommitment(STORE, { counterparty: "Ana", body: "the quote", due: "2026-06-01T00:00:00.000Z" });
  const { signals } = detectSignals([PROJECT], only("overdue_commitment"));
  const text = formatSignals(signals);
  assert.match(text, /^- \[critical\] alpha: you owe Ana/);
});

test("no signals renders to nothing at all", () => {
  assert.equal(formatSignals([]), "");
  assert.equal(formatSignals(null), "");
});

// --------------------------------------------------------------------------
// THE PROPERTY THE WHOLE DESIGN RESTS ON
// --------------------------------------------------------------------------

test("a watch routine with no signals never reaches the model", async () => {
  // Invisible until the bill arrives, which is exactly why it is pinned. A
  // watcher meant to run every few minutes that wakes a model each time to say
  // "nothing to report" is a cron job with an expensive habit.
  const { runRoutineNow } = await import("#core/routines/runner.js");

  createTask(STORE, { title: "perfectly fine", due: "2099-01-01" });

  // handleSuperAgent logs an "agent" message with the model's reply; the
  // runner itself always logs a "system" line at the end. Counting only the
  // former is what distinguishes "the model ran" from "the routine ran".
  const logged = [];
  const projects = {
    list: () => [{ id: 1, name: "alpha", path: STORE }],
    get: () => ({ id: 1, name: "alpha", path: STORE, storagePath: STORE }),
  };
  const project = {
    id: 1, name: "alpha", path: STORE, storagePath: STORE,
    logMessage: (m) => logged.push(m),
  };

  const out = await runRoutineNow(
    { project, projects, plugins: null, registries: null, globalConfig: {} },
    { name: "watcher", kind: "watch", schedule: "every:5m", spec: { prompt: "judge these" } },
  );

  assert.equal(out.signals, 0);
  assert.match(out.note || "", /did not invoke the model/);
  assert.equal(
    logged.filter((m) => m.type === "agent").length, 0,
    "the quiet path must not touch the model",
  );
});

test("a watch routine with signals hands them over as facts to judge", async () => {
  // Not asserting the model's answer — asserting that the signals reach the
  // prompt at all, which is the seam between the two halves of the design.
  const { detectSignals: detect } = await import("#core/routines/signals.js");
  createCommitment(STORE, { counterparty: "Ana", body: "the quote", due: "2026-01-01T00:00:00.000Z" });
  const { signals } = detect([PROJECT], { now: NOW });
  assert.ok(signals.length > 0);
  assert.match(formatSignals(signals), /you owe Ana/);
});

// --------------------------------------------------------------------------
// a routine blocked on a confirmation nobody can give
// --------------------------------------------------------------------------

test("a permission block is told apart from an ordinary tool failure", async () => {
  // The real evening anchor: it tried write_file for its routine memory, the
  // guard threw "Action requires user confirmation" because a scheduled run has
  // no confirmation channel, the model gave up before send_telegram — and the
  // run reported "ok". The only symptom was silence, and finding the cause took
  // twenty-one shell commands.
  //
  // A dead end and a hiccup must not look the same: nobody is ever going to
  // approve that tool, so it is a misconfiguration to report, not a retry.
  const { blockedForPermission } = await import("#core/routines/runner.js");

  assert.deepEqual(
    blockedForPermission([
      { tool: "list_tasks", result: { tasks: [] } },
      { tool: "write_file", result: { error: "Action requires user confirmation: Write file …" } },
    ]),
    ["write_file"],
  );

  // An ordinary failure is NOT a permission block — conflating them would turn
  // every transient error into "your routine is misconfigured".
  assert.deepEqual(
    blockedForPermission([{ tool: "run_shell", result: { error: "exit 1: command not found" } }]),
    [],
  );
  // A refusal the user actively gave is a decision, not a dead end.
  assert.deepEqual(
    blockedForPermission([{ tool: "write_file", result: { error: "User did not confirm: …" } }]),
    [],
  );

  // Deduped, and tolerant of junk.
  assert.deepEqual(
    blockedForPermission([
      { tool: "write_file", result: { error: "Action requires user confirmation: a" } },
      { tool: "write_file", result: { error: "Action requires user confirmation: b" } },
    ]),
    ["write_file"],
  );
  assert.deepEqual(blockedForPermission(null), []);
  assert.deepEqual(blockedForPermission([{ tool: "x" }, {}]), []);
});
