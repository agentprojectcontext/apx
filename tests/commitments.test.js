// Commitments (02-SPEC-capabilities.md § C3).
//
// The design claim being tested: a commitment is not a task with a tag. The
// questions that justify the separate store — "everything I owe Ana", "what
// did I let slip", "how many times have I moved this date" — are the ones a
// tag could not answer, so those are the ones pinned here.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-commit-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const {
  createCommitment, listCommitments, listCommitmentsAcrossProjects,
  getCommitment, patchCommitment, keepCommitment, missCommitment,
  dropCommitment, renegotiateCommitment, countCommitments,
} = await import("#core/stores/commitments.js");

let STORE;
beforeEach(() => {
  STORE = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
});

const YESTERDAY = "2020-01-01T00:00:00.000Z";
const TOMORROW = "2099-01-01T00:00:00.000Z";

function promise(over = {}) {
  return createCommitment(STORE, {
    counterparty: "Ana",
    body: "send the quote",
    due: TOMORROW,
    origin_channel: "telegram",
    ...over,
  });
}

// --------------------------------------------------------------------------
// what makes it a commitment and not a task
// --------------------------------------------------------------------------

test("a commitment without a counterparty is refused", () => {
  // The counterparty IS the type. Allowing it empty would quietly turn this
  // store into a second, worse task list.
  assert.throws(() => createCommitment(STORE, { body: "something" }), /counterparty required/);
});

test("a commitment without a body is refused", () => {
  assert.throws(() => createCommitment(STORE, { counterparty: "Ana" }), /body required/);
});

test("it records who, what, when and where it was said", () => {
  const c = promise({ origin_message_ref: "tg:1720" });
  assert.equal(c.counterparty, "Ana");
  assert.equal(c.origin_channel, "telegram");
  assert.equal(c.origin_message_ref, "tg:1720");
  assert.ok(c.promised_at, "when it was promised is not the same as when it is due");
  assert.equal(c.state, "open");
});

// --------------------------------------------------------------------------
// the query the tag version could not answer
// --------------------------------------------------------------------------

test("everything owed to one person, found by partial name", () => {
  promise({ counterparty: "Ana Pérez", body: "the quote" });
  promise({ counterparty: "ana pérez", body: "the deck" });
  promise({ counterparty: "Bruno", body: "the invoice" });

  const hers = listCommitments(STORE, { counterparty: "ana" });
  assert.equal(hers.length, 2, "free-text names must match case-insensitively or the field is unusable");
  assert.ok(hers.every((c) => /ana/i.test(c.counterparty)));
});

test("overdue is a first-class query, not a date comparison at every call site", () => {
  promise({ body: "late one", due: YESTERDAY });
  promise({ body: "fine one", due: TOMORROW });
  const late = listCommitments(STORE, { overdue: true });
  assert.equal(late.length, 1);
  assert.equal(late[0].body, "late one");
});

test("kept ones drop out of the default view but stay on the record", () => {
  const c = promise();
  keepCommitment(STORE, c.id);
  assert.equal(listCommitments(STORE).length, 0, "default view is what you still owe");
  assert.equal(listCommitments(STORE, { state: "all" }).length, 1);
  assert.equal(countCommitments(STORE).kept, 1);
});

test("a missed one is recorded, not erased", () => {
  // A system that quietly drops what you failed to do cannot tell you that you
  // keep failing the same person.
  const c = promise({ counterparty: "Bruno" });
  missCommitment(STORE, c.id, "forgot entirely");
  const all = listCommitments(STORE, { state: "missed" });
  assert.equal(all.length, 1);
  assert.equal(all[0].note, "forgot entirely");
  assert.equal(countCommitments(STORE).missed, 1);
});

test("one filed by mistake leaves the board without counting as broken", () => {
  // `drop` and `missed` must never collapse into each other: one says nobody
  // was ever waiting, the other says you failed someone who was.
  const c = promise({ counterparty: "Nadie" });
  const dropped = dropCommitment(STORE, c.id, "this was a task");
  assert.equal(dropped.state, "dropped");
  assert.equal(listCommitments(STORE).length, 0, "gone from what you still owe");
  assert.equal(listCommitments(STORE, { state: "dropped" }).length, 1);
  assert.equal(listCommitments(STORE, { state: "all" }).length, 1, "the log still has it");

  const counts = countCommitments(STORE);
  assert.equal(counts.dropped, 1);
  assert.equal(counts.missed, 0, "a mistake is not a broken promise");
  assert.equal(counts.overdue, 0);
});

// --------------------------------------------------------------------------
// renegotiation — the distinction that carries the relationship
// --------------------------------------------------------------------------

test("renegotiating keeps the promise open with the new date", () => {
  const c = promise({ due: "2026-03-01" });
  const moved = renegotiateCommitment(STORE, c.id, "2026-03-15", "agreed on the call");
  assert.equal(moved.state, "open", "a renegotiated promise is still a live promise");
  assert.equal(moved.due, "2026-03-15");
  assert.equal(moved.renegotiated_count, 1);
  assert.equal(listCommitments(STORE).length, 1, "and must not vanish from what you owe");
});

test("every date it has ever had is kept", () => {
  const c = promise({ due: "2026-03-01" });
  renegotiateCommitment(STORE, c.id, "2026-03-15");
  renegotiateCommitment(STORE, c.id, "2026-04-01");
  const final = getCommitment(STORE, c.id);
  assert.equal(final.renegotiated_count, 2);
  assert.deepEqual(final.history.map((h) => h.due), ["2026-03-01", "2026-03-15"]);
  // Moving a date twice is a fact about the relationship. It is only visible
  // because the history survives.
});

test("renegotiating without a new date is refused", () => {
  const c = promise();
  assert.throws(() => renegotiateCommitment(STORE, c.id, null), /new due date is required/);
});

// --------------------------------------------------------------------------
// storage behaviour inherited from the tasks pattern
// --------------------------------------------------------------------------

test("the log is append-only and folds back to the same state", () => {
  const c = promise();
  patchCommitment(STORE, c.id, { body: "send the revised quote" });
  keepCommitment(STORE, c.id);

  const dir = path.join(STORE, "commitments");
  const files = fs.readdirSync(dir);
  const lines = fs.readFileSync(path.join(dir, files[0]), "utf8").trim().split("\n");
  assert.equal(lines.length, 3, "create + update + kept, nothing rewritten");

  const folded = getCommitment(STORE, c.id);
  assert.equal(folded.body, "send the revised quote");
  assert.equal(folded.state, "kept");
});

test("a corrupt line is skipped rather than blanking the list", () => {
  const c = promise();
  const dir = path.join(STORE, "commitments");
  const file = path.join(dir, fs.readdirSync(dir)[0]);
  fs.appendFileSync(file, "{ this is not json\n");
  assert.equal(listCommitments(STORE).length, 1);
  assert.ok(getCommitment(STORE, c.id));
});

test("an id prefix resolves when it is unambiguous", () => {
  const c = promise();
  assert.equal(getCommitment(STORE, c.id.slice(0, 4))?.id, c.id);
  assert.equal(getCommitment(STORE, "zz"), null);
});

test("sorted by deadline, undated last", () => {
  promise({ body: "no date", due: null });
  promise({ body: "later", due: "2026-06-01" });
  promise({ body: "sooner", due: "2026-01-01" });
  const rows = listCommitments(STORE);
  assert.deepEqual(rows.map((c) => c.body), ["sooner", "later", "no date"]);
});

// --------------------------------------------------------------------------
// cross-project — where a chief of staff actually lives
// --------------------------------------------------------------------------

test("promises fold across projects, each carrying its own", () => {
  const a = fs.mkdtempSync(path.join(TMP_HOME, "pa-"));
  const b = fs.mkdtempSync(path.join(TMP_HOME, "pb-"));
  createCommitment(a, { counterparty: "Ana", body: "the quote", due: "2026-02-01" });
  createCommitment(b, { counterparty: "Ana", body: "the deck", due: "2026-01-01" });

  const { commitments } = listCommitmentsAcrossProjects([
    { id: 1, name: "alpha", storagePath: a },
    { id: 2, name: "beta", storagePath: b },
  ], { counterparty: "Ana" });

  assert.equal(commitments.length, 2);
  assert.equal(commitments[0].project_name, "beta", "soonest first, across the boundary");
  assert.ok(commitments.every((c) => c.project_id));
});

test("one unreadable project is skipped, not fatal", () => {
  const good = fs.mkdtempSync(path.join(TMP_HOME, "good-"));
  createCommitment(good, { counterparty: "Ana", body: "fine" });

  const { commitments, skipped } = listCommitmentsAcrossProjects([
    { id: 1, name: "good", storagePath: good },
    { id: 2, name: "broken", storagePath: null },
    { id: 3, name: "missing", storagePath: "/nope/does/not/exist" },
  ]);
  // A null storagePath is not a registered store at all, so it is skipped
  // silently; a path that should work but does not is what gets reported.
  assert.equal(commitments.length, 1);
  assert.ok(Array.isArray(skipped));
});
