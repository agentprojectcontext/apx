// The executive layer's three brakes and its one exit.
//
// Every test here is a thing that, if it broke, would break QUIETLY: a guard
// that stops deduplicating turns a useful layer into noise the owner learns to
// skip; a rubric that stops running lets a malformed brief reach them; a source
// whose failure is swallowed turns "no data" into an invented number. None of
// those raise an error on their own.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-company-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const {
  RITUALS, policyFrom, DEFAULT_POLICY,
  decide, fingerprint, parseSeverity, isQuietHour,
  lint, formatFindings,
  appendEntry, readLedger, renderPastDecisions,
  collectSources, renderSource,
  handoff,
} = await import("#core/company/index.js");
const { artifactsDir } = await import("#core/stores/artifacts.js");

const NOW = new Date("2026-09-11T15:00:00Z"); // 12:00 in Buenos Aires — inside the window
const NIGHT = new Date("2026-09-12T04:00:00Z"); // 01:00 local

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-co-proj-"));
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "apx-co-store-"));
  fs.mkdirSync(artifactsDir(storage), { recursive: true });
  return { path: root, name: "Acme", storagePath: storage };
}

function source(p, name, body) {
  const file = path.join(artifactsDir(p.storagePath), `source-${name}.sh`);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

test("every ritual's scheduled hour falls outside quiet hours", () => {
  // A ritual scheduled inside the quiet window is held every single time, and
  // the layer looks like it stopped working rather than like it was muted.
  const { from, to } = DEFAULT_POLICY.quietHours;
  for (const [name, r] of Object.entries(RITUALS)) {
    const quiet = from > to ? r.hour >= from || r.hour < to : r.hour >= from && r.hour < to;
    assert.equal(quiet, false, `${name} runs at ${r.hour}h, inside quiet hours`);
  }
});

test("the same finding twice is dropped, but different numbers are different news", () => {
  const brief = "- [app] 2 tasks overdue → close them";
  const history = [{ action: "send", at: "2026-09-10T15:00:00Z", ritual: "daily", hash: fingerprint(brief) }];
  assert.equal(decide({ brief, ritual: "daily", now: NOW, history }).action, "drop");

  const other = "- [app] 7 tasks overdue → close them";
  assert.equal(decide({ brief: other, ritual: "daily", now: NOW, history }).action, "send");
});

test("a date change is not new news", () => {
  assert.equal(
    fingerprint("- [app] overdue since 2026-09-01 → close it"),
    fingerprint("- [app] overdue since 2026-09-08 → close it"),
  );
});

test("the night holds everything except a blocker", () => {
  const brief = "- [app] something → do it";
  assert.equal(decide({ brief, ritual: "daily", now: NIGHT, history: [] }).action, "hold");
  assert.equal(
    decide({ brief: `SEVERITY: blocker\n${brief}`, ritual: "daily", now: NIGHT, history: [] }).action,
    "send",
  );
  assert.equal(isQuietHour(NIGHT, DEFAULT_POLICY), true);
});

test("the weekly quota holds, and a blocker still gets through", () => {
  const history = Array.from({ length: 4 }, (_, i) => ({
    action: "send", at: `2026-09-0${i + 5}T15:00:00Z`, ritual: "weekly", hash: `h${i}`,
  }));
  const brief = "- [app] another one → decide";
  assert.equal(decide({ brief, ritual: "daily", now: NOW, history }).action, "hold");
  assert.equal(decide({ brief: `SEVERITY: blocker\n${brief}`, ritual: "daily", now: NOW, history }).action, "send");
});

test("a settings change moves the policy, not just the words", () => {
  const policy = policyFrom({ quiet_hours: "0-23", weekly_deliveries: 1 });
  assert.equal(isQuietHour(NOW, policy), true, "a window of 0-23 means almost always quiet");
  assert.equal(policy.weeklyCap, 1);
});

test("the severity line is parsed and stripped, never delivered", () => {
  const { severity, body } = parseSeverity("SEVERITY: blocker\n- [app] x → y");
  assert.equal(severity, "blocker");
  assert.equal(body, "- [app] x → y");
  assert.equal(parseSeverity("SEVERIDAD: fyi\n- [a] b → c").severity, "fyi", "the Spanish spelling too");
});

test("the rubric catches what a model gets wrong, not what it thinks", () => {
  assert.equal(lint("- [app] it expired → close it", { ritual: "daily" }).ok, true);
  const rules = (text) => lint(text, { ritual: "daily" }).findings.map((f) => f.rule);
  assert.deepEqual(rules("- it expired → close it"), ["bullet-scope"]);
  assert.deepEqual(rules("- [app] it expired"), ["bullet-recommendation"]);
  assert.ok(rules("- [app] TODO check → fix").includes("no-placeholder"));
  assert.ok(rules("- [app] x → send_telegram to the owner").includes("no-self-delivery"));
  // "todo" is an ordinary Spanish word; only the placeholder spelling counts.
  assert.equal(lint("- [app] todo con movimiento → seguir", { ritual: "daily" }).ok, true);
});

test("NO_MESSAGE is a complete answer, but only with a reason", () => {
  assert.equal(lint("NO_MESSAGE — nothing changed since yesterday", { ritual: "daily" }).ok, true);
  assert.deepEqual(lint("NO_MESSAGE", { ritual: "daily" }).findings.map((f) => f.rule), ["no-message-reason"]);
});

test("a source that fails is reported, never silently dropped", () => {
  const p = project();
  source(p, "board", "echo '<board status=\"ok\">3 open</board>'");
  source(p, "money", "echo 'boom' >&2; exit 1");
  const out = collectSources(p.storagePath, { cwd: p.path });
  assert.equal(out.summary, "board=ok · money=unavailable");
  assert.match(out.blocks.join("\n"), /<money status="unavailable">/);
});

test("a source that declares itself down is believed, not overruled by its exit code", () => {
  const p = project();
  source(p, "money", "echo '<money status=\"unavailable\">401</money>'");
  const out = collectSources(p.storagePath, { cwd: p.path });
  assert.equal(out.summary, "money=unavailable", "the status line must not contradict the block below it");
});

test("a source can sit a ritual out", () => {
  const p = project();
  source(p, "money", 'if [ "$APX_RITUAL" != "monthly" ]; then echo APX_SKIP; exit 0; fi; echo "<money>4</money>"');
  assert.equal(collectSources(p.storagePath, { cwd: p.path, env: { APX_RITUAL: "daily" } }).summary, "");
  assert.equal(collectSources(p.storagePath, { cwd: p.path, env: { APX_RITUAL: "monthly" } }).summary, "money=ok");
});

test("a malformed brief reaches the ledger and not the owner", () => {
  const p = project();
  const policy = policyFrom({});
  let delivered = false;
  const out = handoff({
    brief: "no bullets, no scope, no recommendation",
    ritual: "daily", project: p, policy, orchestrator: "roby", now: NOW,
    deliver: () => { delivered = true; return ""; },
  });
  assert.equal(out.action, "rejected");
  assert.equal(delivered, false);
  const entries = readLedger(path.resolve(p.path, policy.ledgerPath));
  assert.equal(entries.at(-1).action, "rejected");
});

test("a good brief is delivered with its severity, and recorded", () => {
  const p = project();
  const policy = policyFrom({});
  const calls = [];
  const out = handoff({
    brief: "SEVERITY: blocker\n- [app] prod is down → roll back",
    ritual: "daily", project: p, policy, orchestrator: "roby", now: NIGHT,
    deliver: (payload) => { calls.push(payload); return "ok"; },
  });
  assert.equal(out.action, "send", "a blocker crosses the night");
  assert.equal(calls[0].severity, "blocker");
  assert.equal(calls[0].orchestrator, "roby");
  assert.doesNotMatch(calls[0].body, /SEVERITY/, "the marker is ours, not the owner's");
  assert.equal(readLedger(path.resolve(p.path, policy.ledgerPath)).at(-1).action, "send");
});

test("a failed delivery is recorded as failed, not as silence", () => {
  const p = project();
  const policy = policyFrom({});
  const out = handoff({
    brief: "- [app] x → y", ritual: "daily", project: p, policy, orchestrator: "roby", now: NOW,
    deliver: () => { throw new Error("ETIMEDOUT"); },
  });
  assert.equal(out.action, "failed");
  assert.match(readLedger(path.resolve(p.path, policy.ledgerPath)).at(-1).reason, /ETIMEDOUT/);
});

test("a dry run decides and explains without spending an interruption", () => {
  const p = project();
  const policy = policyFrom({});
  let delivered = false;
  const out = handoff({
    brief: "- [app] x → y", ritual: "daily", project: p, policy, orchestrator: "roby", now: NOW,
    dryRun: true, deliver: () => { delivered = true; return ""; },
  });
  assert.equal(out.action, "send");
  assert.equal(delivered, false);
  assert.deepEqual(readLedger(path.resolve(p.path, policy.ledgerPath)), [], "and writes nothing");
});

test("the past comes back with its outcome, which is the point", () => {
  const p = project();
  const file = path.resolve(p.path, "work/exec/DECISIONS.md");
  appendEntry({ at: NOW, ritual: "daily", action: "drop", reason: "dup", body: "- [app] x → y" }, file);
  const block = renderPastDecisions(readLedger(file));
  assert.match(block, /daily · drop/);
  assert.match(renderPastDecisions([]), /first run/);
});
