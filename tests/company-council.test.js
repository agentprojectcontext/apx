// The council desk.
//
// The layer shipped with one autonomous agent and five advisors nobody ever
// called: the orchestrator was allowed to consult them, one question per run
// and only if it changed the recommendation — and since most runs end in
// NO_MESSAGE there was never anything to go deeper on. In a month of a2a
// traffic on the live project, `ceo → cfo|coo|cmo|chro|gc` was zero.
//
// So each area now runs on its own cadence and leaves a note here, and the
// orchestrator finds the desk already set. These pin the three things that
// make that safe: an area cannot reach the owner, a quiet week CLEARS the note
// instead of leaving a stale one, and the desk never grows without bound.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "apx-council-"));
process.env.APX_HOME = path.join(TMP, ".apx");

const {
  writeNote, readNotes, renderCouncil, noteFile, NOTE_MAX_AGE_DAYS,
  buildContext, policyFrom, RITUALS,
} = await import("#core/company/index.js");

let seq = 0;
function makeStore() {
  const root = fs.mkdtempSync(path.join(TMP, `store-${seq++}-`));
  return root;
}

const BULLET = "- [billing] MercadoPago rechazó 3 cobros esta semana → revisar el token antes del lunes";

// --- filing ----------------------------------------------------------------

test("a note is filed under its area and read back with its age", () => {
  const store = makeStore();
  writeNote(store, "cfo", { body: BULLET, at: new Date("2026-09-08T07:00:00Z") });

  const notes = readNotes(store, { now: new Date("2026-09-11T07:00:00Z") });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].area, "cfo");
  assert.equal(notes[0].body, BULLET);
  assert.equal(Math.round(notes[0].ageDays), 3);
});

test("filing again replaces — the desk holds what is true now, not a history", () => {
  const store = makeStore();
  writeNote(store, "coo", { body: "- [deploy] la semana pasada → x" });
  writeNote(store, "coo", { body: "- [deploy] esta semana → y" });

  const notes = readNotes(store);
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /esta semana/);
  assert.doesNotMatch(notes[0].body, /la semana pasada/);
});

test("a quiet week CLEARS the note instead of leaving last week's on the desk", () => {
  // This is the whole reason NO_MESSAGE is handled here and not just linted:
  // a note nobody clears is how a problem fixed nine days ago keeps being
  // reported as current.
  const store = makeStore();
  writeNote(store, "gc", { body: BULLET });
  assert.ok(fs.existsSync(noteFile(store, "gc")));

  const out = writeNote(store, "gc", { body: "NO_MESSAGE — nada se movió en legales" });
  assert.equal(out.empty, true);
  assert.ok(!fs.existsSync(noteFile(store, "gc")));
  assert.deepEqual(readNotes(store), []);
});

test("an empty body clears too, and clearing what was never there does not throw", () => {
  const store = makeStore();
  assert.equal(writeNote(store, "cmo", { body: "   " }).empty, true);
  assert.deepEqual(readNotes(store), []);
});

test("a note that aged out is not shown — a stale answer is worse than none", () => {
  const store = makeStore();
  const old = new Date(Date.now() - (NOTE_MAX_AGE_DAYS + 2) * 86_400_000);
  writeNote(store, "chro", { body: BULLET, at: old });
  assert.deepEqual(readNotes(store), []);
  // Still on disk: aging out is a display rule, not a delete.
  assert.ok(fs.existsSync(noteFile(store, "chro")));
});

test("an area is a slug, never a path", () => {
  const store = makeStore();
  for (const bad of ["../../evil", "a/b", ".hidden", "", "Ceo Agent"]) {
    assert.throws(() => writeNote(store, bad, { body: BULLET }), /invalid area|area required/);
  }
});

test("an unreadable note costs one voice, not the run", () => {
  const store = makeStore();
  writeNote(store, "cfo", { body: BULLET });
  fs.mkdirSync(path.join(store, "company", "council", "coo.md"), { recursive: true }); // a directory, not a file
  const notes = readNotes(store);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].area, "cfo");
});

// --- the rubric rides along, it does not bin the note ----------------------

test("a note that drifts from the format is filed, with the drift recorded", () => {
  // The opposite call from `handoff`, and on purpose. A brief reaches the
  // owner, so a malformed one is refused. A note reaches the orchestrator,
  // whose own brief is linted anyway — so refusing it only throws away the
  // findings that were good. The first live run lost a 401 on the billing
  // source and a three-way price disagreement because a third bullet had no
  // arrow.
  const store = makeStore();
  writeNote(store, "cfo", { body: BULLET, issues: "bullet-recommendation (line 5): no arrow" });

  const [note] = readNotes(store);
  assert.match(note.body, /MercadoPago/, "the findings survive");
  assert.match(note.issues, /bullet-recommendation/, "and the drift is on the record");
  assert.match(renderCouncil([note]), /rubric="bullet-recommendation[^"]*"/);
});

test("a clean note carries no rubric attribute", () => {
  const store = makeStore();
  writeNote(store, "coo", { body: BULLET });
  assert.equal(readNotes(store)[0].issues, "");
  assert.doesNotMatch(renderCouncil(readNotes(store)), /rubric=/);
});

test("a rejected note must never look like a quiet week", () => {
  // The failure mode that made the gate wrong: with the note binned, the desk
  // said "nobody reported" when somebody had, and the orchestrator has no way
  // to tell those apart.
  const store = makeStore();
  writeNote(store, "gc", { body: BULLET, issues: "max-lines: 14 lines" });
  assert.equal(readNotes(store).length, 1);
  assert.doesNotMatch(renderCouncil(readNotes(store)), /no notes on the desk/);
});

// --- rendering -------------------------------------------------------------

test("an empty desk says so out loud", () => {
  // "Nobody reported" and "they had nothing to report" are different facts and
  // the orchestrator has to be able to tell them apart.
  assert.match(renderCouncil([]), /no notes on the desk/);
});

test("the block names the area and how old the note is", () => {
  const store = makeStore();
  writeNote(store, "cfo", { body: BULLET, at: new Date("2026-09-08T07:00:00Z") });
  const out = renderCouncil(readNotes(store, { now: new Date("2026-09-11T07:00:00Z") }));
  assert.match(out, /<note area="cfo" at="2026-09-08T07:00Z" age="3d ago">/);
  assert.match(out, /MercadoPago/);
  assert.match(out, /<\/council>/);
});

// --- who sees what ---------------------------------------------------------

function fakeProject(store) {
  const root = fs.mkdtempSync(path.join(TMP, `proj-${seq++}-`));
  return { path: root, storagePath: store, name: "acme" };
}

test("the orchestrator's rituals get the desk", () => {
  const store = makeStore();
  writeNote(store, "cfo", { body: BULLET });
  const out = buildContext({ ritual: "weekly", project: fakeProject(store), policy: policyFrom({}) });
  assert.match(out.text, /<council>/);
  assert.match(out.text, /MercadoPago/);
  assert.equal(out.council.length, 1);
});

test("an area does NOT get the desk, or the owner's interruption budget", () => {
  // Reading the desk it is about to write to is an echo chamber — it would
  // find its own note from last week and restate it. And the guard counts
  // interruptions of the owner, which an area can never make: showing it a
  // budget it cannot spend only teaches it to self-censor for the wrong reason.
  const store = makeStore();
  writeNote(store, "cfo", { body: BULLET });
  const out = buildContext({ ritual: "council", project: fakeProject(store), policy: policyFrom({}) });
  assert.doesNotMatch(out.text, /<council>/);
  assert.doesNotMatch(out.text, /MercadoPago/);
  assert.doesNotMatch(out.text, /<guard>/);
  assert.deepEqual(out.council, []);
});

test("council is a ritual of its own, and the one that stops at the desk", () => {
  assert.ok(RITUALS.council, "the ritual exists");
  assert.equal(RITUALS.council.toDesk, true);
  for (const slug of ["daily", "weekly", "biweekly", "monthly"]) {
    assert.ok(!RITUALS[slug].toDesk, `${slug} reaches the owner and must not be marked toDesk`);
  }
});

// --- the preamble ----------------------------------------------------------

test("prose before the first finding is caught on the desk, and only there", async () => {
  // "No preamble" is in every ritual's contract and nothing checked it: the
  // first live council run opened with "Now I have a complete picture of the
  // financial landscape. Let me deliver the report." — the model thinking out
  // loud, filed as if it were a finding.
  const { lint } = await import("#core/company/index.js");
  const withPreamble = `Ahora tengo el panorama. Va el reporte.\n\n${BULLET}`;

  const desk = lint(withPreamble, { ritual: "council" });
  assert.ok(desk.findings.some((f) => f.rule === "no-preamble"));

  // A brief reaching the owner keeps the rules it has. Tightening the format
  // there would start refusing runs that pass today, and silencing the
  // owner-facing path is not a side effect a formatting rule gets to have.
  for (const ritual of ["daily", "weekly", "biweekly", "monthly"]) {
    assert.ok(
      !lint(withPreamble, { ritual }).findings.some((f) => f.rule === "no-preamble"),
      `${ritual} must not start refusing what it accepts today`,
    );
  }
});

test("a note that opens with a finding is clean", async () => {
  const { lint } = await import("#core/company/index.js");
  assert.equal(lint(BULLET, { ritual: "council" }).ok, true);
});
