// The interruption budget (02-SPEC-capabilities.md § C5).
//
// Two things are being protected here. The obvious one: the limits work. The
// one that matters more: the gate never touches a message the user asked for.
// A budget that can swallow an answer reads as a broken bot, and the user's
// fix for a broken bot is to turn it off — which is the exact outcome the
// budget exists to prevent.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-nudge-"));
process.env.HOME = TMP_HOME;

const {
  canNudge, recordNudge, recordFeedback, applyNudgeCallback,
  nudgeFeedbackKeyboard, resolveNudgePolicy, listNudges, nudgeStats,
} = await import("#core/nudge/index.js");
const { isQuietAt, parseQuietHours, quietEndsAt } = await import("#core/nudge/policy.js");
const { _resetNudgeLedger } = await import("#core/nudge/store.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A config with the budget switched on. */
function budget(over = {}) {
  return { nudge: { enabled: true, daily_max: 3, ...over } };
}

beforeEach(() => _resetNudgeLedger());

// --------------------------------------------------------------------------
// the invariant: solicited traffic is never gated
// --------------------------------------------------------------------------

test("a message the user asked for passes even with the budget fully spent", () => {
  const cfg = budget({ daily_max: 1 });
  const first = canNudge({ kind: "signal" }, cfg);
  assert.equal(first.allowed, true);
  recordNudge(first, { preview: "spent it" });

  // The budget is now gone for unrequested messages...
  assert.equal(canNudge({ kind: "signal" }, cfg).allowed, false);

  // ...and a reply still goes out.
  const reply = canNudge({ kind: "reply", unsolicited: false }, cfg);
  assert.equal(reply.allowed, true);
  assert.equal(reply.reason, "solicited");
});

test("solicited traffic is not written to the ledger", () => {
  const cfg = budget();
  const gate = canNudge({ kind: "reply", unsolicited: false }, cfg);
  assert.equal(recordNudge(gate, { preview: "an answer" }), null);
  assert.equal(listNudges().length, 0, "replies must not fill the interruption log");
});

test("quiet hours never silence a reply", () => {
  const cfg = budget({ quiet_hours: "00:00-23:59" });
  const at3am = new Date(2026, 0, 15, 3, 0, 0);
  assert.equal(canNudge({ kind: "signal" }, cfg, at3am).allowed, false);
  assert.equal(canNudge({ kind: "reply", unsolicited: false }, cfg, at3am).allowed, true);
});

// --------------------------------------------------------------------------
// vanilla: no profile, no config → nothing changes
// --------------------------------------------------------------------------

test("with no policy configured the gate allows everything", () => {
  const gate = canNudge({ kind: "wakeup" }, {});
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, "budget-disabled");
});

test("the disabled gate still records, so the ledger is useful before anyone opts in", () => {
  const gate = canNudge({ kind: "wakeup" }, {});
  recordNudge(gate, { preview: "online" });
  assert.equal(listNudges().length, 1);
});

// --------------------------------------------------------------------------
// the limits themselves
// --------------------------------------------------------------------------

test("the daily ceiling holds and reports when to retry", () => {
  const cfg = budget({ daily_max: 2 });
  for (let i = 0; i < 2; i++) {
    const g = canNudge({ kind: "signal" }, cfg);
    assert.equal(g.allowed, true, `nudge ${i + 1} should fit`);
    recordNudge(g, { preview: `n${i}` });
  }
  const denied = canNudge({ kind: "signal" }, cfg);
  assert.equal(denied.allowed, false);
  assert.match(denied.reason, /daily budget spent \(2\/2\)/);
  assert.ok(denied.retry_after_ms > 0, "a refusal must say when to come back");
});

test("the ceiling counts the day, not the process — it survives a restart", async () => {
  const cfg = budget({ daily_max: 1 });
  const g = canNudge({ kind: "signal" }, cfg);
  recordNudge(g, { preview: "before" });

  // Re-import with a cache-busting query: a fresh module instance, same disk.
  const fresh = await import(`#core/nudge/index.js?restart=${Date.now()}`);
  assert.equal(fresh.canNudge({ kind: "signal" }, cfg).allowed, false);
});

test("a cooldown applies per project without blocking a different one", () => {
  const cfg = budget({ daily_max: 0, project_cooldown_minutes: 60 });
  const a = canNudge({ kind: "signal", project_id: "alpha" }, cfg);
  recordNudge(a, { preview: "alpha" });

  assert.equal(canNudge({ kind: "signal", project_id: "alpha" }, cfg).allowed, false);
  assert.equal(canNudge({ kind: "signal", project_id: "beta" }, cfg).allowed, true);
});

test("a cooldown applies per kind without blocking a different kind", () => {
  const cfg = budget({ daily_max: 0, kind_cooldown_minutes: 60 });
  recordNudge(canNudge({ kind: "stale_project" }, cfg), { preview: "x" });
  assert.equal(canNudge({ kind: "stale_project" }, cfg).allowed, false);
  assert.equal(canNudge({ kind: "overdue_commitment" }, cfg).allowed, true);
});

test("critical may bypass the budget, and the bypass is on the record", () => {
  const cfg = budget({ daily_max: 1 });
  recordNudge(canNudge({ kind: "signal" }, cfg), { preview: "spent" });
  assert.equal(canNudge({ kind: "signal" }, cfg).allowed, false);

  const crit = canNudge({ kind: "signal", severity: "critical" }, cfg);
  assert.equal(crit.allowed, true);
  assert.equal(crit.bypassed_budget, true);
  recordNudge(crit, { preview: "the roof is on fire" });

  const logged = listNudges().find((e) => e.bypassed_budget);
  assert.ok(logged, "a bypass that leaves no trace is a backdoor");
});

test("a bypass does not consume the budget it skipped", () => {
  const cfg = budget({ daily_max: 2 });
  recordNudge(canNudge({ kind: "signal", severity: "critical" }, cfg), { preview: "crit" });
  const normal = canNudge({ kind: "signal" }, cfg);
  assert.equal(normal.allowed, true, "an emergency must not eat the ordinary allowance");
});

test("critical_bypasses_budget:false actually stops it", () => {
  const cfg = budget({ daily_max: 1, critical_bypasses_budget: false });
  recordNudge(canNudge({ kind: "signal" }, cfg), { preview: "spent" });
  assert.equal(canNudge({ kind: "signal", severity: "critical" }, cfg).allowed, false);
});

// --------------------------------------------------------------------------
// quiet hours
// --------------------------------------------------------------------------

test("a quiet window that crosses midnight covers both sides of it", () => {
  const spec = "22:00-07:30";
  assert.equal(isQuietAt(spec, new Date(2026, 0, 15, 23, 30)), true, "before midnight");
  assert.equal(isQuietAt(spec, new Date(2026, 0, 15, 3, 0)), true, "after midnight");
  assert.equal(isQuietAt(spec, new Date(2026, 0, 15, 7, 29)), true, "one minute before it lifts");
  assert.equal(isQuietAt(spec, new Date(2026, 0, 15, 7, 30)), false, "the moment it lifts");
  assert.equal(isQuietAt(spec, new Date(2026, 0, 15, 14, 0)), false, "the middle of the day");
});

test("an unparseable window means never quiet, not always quiet", () => {
  // Failing open here is deliberate: a typo in a config field must not
  // silently mute the agent for good.
  assert.equal(parseQuietHours("22-7"), null);
  assert.equal(isQuietAt("22-7", new Date(2026, 0, 15, 23, 0)), false);
  assert.equal(isQuietAt("", new Date(2026, 0, 15, 3, 0)), false);
});

test("a suppressed nudge says when quiet ends, crossing midnight correctly", () => {
  const cfg = budget({ quiet_hours: "22:00-07:30" });
  const at2330 = new Date(2026, 0, 15, 23, 30);
  const gate = canNudge({ kind: "signal" }, cfg, at2330);
  assert.equal(gate.allowed, false);
  const ends = quietEndsAt("22:00-07:30", at2330);
  assert.equal(ends.getDate(), 16, "07:30 is tomorrow, not eight hours ago");
  assert.equal(gate.retry_after_ms, ends - at2330);
});

// --------------------------------------------------------------------------
// policy layering — core default < profile < user
// --------------------------------------------------------------------------

test("the user's setting beats the profile's", () => {
  const cfg = { nudge: { enabled: true, daily_max: 9 } };
  const policy = resolveNudgePolicy(cfg);
  assert.equal(policy.daily_max, 9);
  assert.ok(policy.source.includes("user"));
});

test("core defaults leave the gate off — vanilla APX delivers what it always did", () => {
  const policy = resolveNudgePolicy({});
  assert.equal(policy.enabled, false);
  assert.deepEqual(policy.source, ["defaults"]);
});

// --------------------------------------------------------------------------
// the feedback loop
// --------------------------------------------------------------------------

test("a button press lands on the right entry and shows up in the stats", () => {
  const gate = canNudge({ kind: "stale_project" }, budget());
  recordNudge(gate, { preview: "nothing on beta for 9 days" });

  const kb = nudgeFeedbackKeyboard(gate.nudge_id);
  const noise = kb.inline_keyboard[0].find((b) => b.callback_data.endsWith(":noise"));
  const result = applyNudgeCallback(noise.callback_data);

  assert.equal(result.entry.feedback.useful, false);
  const stats = nudgeStats();
  assert.equal(stats.by_kind.find((k) => k.kind === "stale_project").noise, 1);
});

test("a button from a message older than the ledger answers instead of throwing", () => {
  const result = applyNudgeCallback("apx:nudge:ndg_gone:useful");
  assert.equal(result.entry, null);
  assert.ok(result.ack, "the user still gets an answer to their tap");
});

test("a callback belonging to another feature is left alone", () => {
  assert.equal(applyNudgeCallback("apx:ask:abc:opt:1"), null);
  assert.equal(applyNudgeCallback(""), null);
});

test("feedback on an unknown id is null, not a crash", () => {
  assert.equal(recordFeedback("ndg_nope", true), null);
});

// --------------------------------------------------------------------------
// THE AUDIT — every unrequested push path goes through the gate
//
// This is the test the spec asked for as a grep in the PR. It lives here
// instead so it keeps holding after the PR is merged: a fifth push path added
// next year fails this, and its author finds out before the user does.
// --------------------------------------------------------------------------

const PUSH_PATHS = [
  "src/host/daemon/wakeup.js",              // boot greeting
  "src/host/daemon/api/telegram.js",        // POST /telegram/notify
  "src/core/agent/tools/handlers/send-telegram.js", // the model's own send tool
  "src/host/daemon/callback-reconciler.js", // late runtime results
];

test("all four outbound push paths import the gate", () => {
  for (const rel of PUSH_PATHS) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.match(src, /from "#core\/nudge\/index\.js"/, `${rel} does not import the gate`);
    assert.match(src, /canNudge\(/, `${rel} imports the gate but never asks it`);
  }
});

test("the gate is NOT wired into the shared send, which also carries replies", () => {
  // If this ever fails, someone moved the gate somewhere convenient and the
  // bot is now capable of not answering when spoken to.
  const plugin = fs.readFileSync(
    path.join(ROOT, "src/host/daemon/plugins/telegram/index.js"), "utf8",
  );
  assert.doesNotMatch(plugin, /canNudge\(/,
    "the telegram plugin's send() must stay dumb — gating there would swallow replies");
});

test("no push path outside the audited four calls the telegram plugin's send", () => {
  // Catches the real failure mode: not a missing import, but a NEW file that
  // sends without anyone remembering this list exists.
  const allowed = new Set([
    ...PUSH_PATHS,
    "src/host/daemon/plugins/telegram/index.js", // defines it
    "src/core/channels/telegram/reply.js",       // the reply path — solicited by construction
  ]);
  const offenders = [];
  for (const file of walk(path.join(ROOT, "src"))) {
    const rel = path.relative(ROOT, file);
    if (allowed.has(rel)) continue;
    const src = fs.readFileSync(file, "utf8");
    if (/\btelegram\.send\s*\(/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders.sort(), [],
    `these send unprompted without passing the budget: ${offenders.join(", ")}`);
});

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      yield* walk(full);
    } else if (e.name.endsWith(".js")) {
      yield full;
    }
  }
}
