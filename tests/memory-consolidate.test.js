// Post-session memory consolidation (02-SPEC-capabilities.md § C8).
//
// The spec's warning is the thing under test: "a memory that grows without
// criterion becomes noise injected into every prompt". memory.md ships on
// every turn of every channel, so the bias must be toward NOT saving, and the
// user must be able to undo a run without losing anything they wrote.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-consolidate-"));
process.env.HOME = TMP_HOME;

const {
  proposeConsolidation, applyConsolidation, revertConsolidation,
  looksDurable, similarity, notebookSize, DEFAULT_LIMITS,
} = await import("#core/memory/consolidate.js");
const { SELF_MEMORY_PATH, readSelfMemory, appendSelfMemory } = await import("#core/agent/self-memory.js");

beforeEach(() => {
  try { fs.rmSync(SELF_MEMORY_PATH, { force: true }); } catch { /* nothing there */ }
});

const DURABLE = "Manu prefers pnpm instead of npm for every APX package";
const CHATTER = "ok dale, gracias";

// --------------------------------------------------------------------------
// what counts as worth keeping
// --------------------------------------------------------------------------

test("a lasting preference is durable; an acknowledgement is not", () => {
  assert.equal(looksDurable(DURABLE), true);
  assert.equal(looksDurable(CHATTER), false);
});

test("today-scoped statements are rejected — they are false tomorrow", () => {
  // The costly failure mode is a note that was true once, injected into every
  // prompt forever.
  assert.equal(looksDurable("today Manu prefers to work on the parser"), false);
  assert.equal(looksDurable("voy a revisar el deploy ahora mismo, siempre"), false);
});

test("too short is chatter and too long is a paragraph", () => {
  assert.equal(looksDurable("prefers x"), false, "under the floor");
  assert.equal(looksDurable("prefers " + "x".repeat(400)), false, "over the ceiling");
});

test("a line with no durability marker at all is rejected", () => {
  assert.equal(looksDurable("the build finished and the artifacts were uploaded"), false);
});

// --------------------------------------------------------------------------
// dedup
// --------------------------------------------------------------------------

test("the same fact phrased differently is not saved twice", () => {
  const { kept, rejected } = proposeConsolidation(
    ["Manu prefers pnpm rather than npm across every APX package"],
    { existing: `# n\n\n## 2026-01-01\n- ${DURABLE}\n` },
  );
  assert.deepEqual(kept, []);
  assert.match(rejected[0].reason, /already known/);
});

test("one run cannot save the same fact twice from two lines", () => {
  const { kept } = proposeConsolidation(
    [DURABLE, "Manu prefers pnpm instead of npm on all APX packages"],
    { existing: "" },
  );
  assert.equal(kept.length, 1);
});

test("similarity is symmetric and bounded", () => {
  assert.equal(similarity("", "anything"), 0);
  assert.ok(similarity(DURABLE, DURABLE) > 0.99);
  assert.equal(similarity(DURABLE, "completely unrelated sentence here"), 0);
  assert.equal(similarity(DURABLE, CHATTER), similarity(CHATTER, DURABLE));
});

// --------------------------------------------------------------------------
// the per-run ceiling
// --------------------------------------------------------------------------

test("a run proposes at most a handful, however much it was given", () => {
  // A day is not a biography. Without this, one chatty session doubles the
  // per-turn cost of every channel forever.
  // Genuinely unrelated facts, sharing no vocabulary — otherwise dedup does
  // the trimming and the ceiling is never exercised.
  const many = [
    "Manu prefers pnpm over npm across every package here",
    "Deployment always happens through GitHub Actions, never manually",
    "Documentation must always ship bilingual, Spanish alongside English",
    "Telegram is always the primary channel; desktop stays secondary",
    "Testing rule: temporary directories, never the developer's own home",
    "Releases always follow semantic versioning with generated changelogs",
    "Migrations always run forward; rollback never happens in place",
    "Review rule: one approval before anything reaches trunk",
  ];
  const { kept, rejected } = proposeConsolidation(many, { existing: "" });
  assert.equal(kept.length, DEFAULT_LIMITS.max_candidates);
  assert.ok(rejected.some((r) => /over the per-run limit/.test(r.reason)));
});

test("every rejection says why", () => {
  const { rejected } = proposeConsolidation([CHATTER], { existing: "" });
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason, "a silent drop is indistinguishable from a bug");
});

// --------------------------------------------------------------------------
// proposing is not writing
// --------------------------------------------------------------------------

test("proposing touches nothing on disk", () => {
  proposeConsolidation([DURABLE], { existing: "" });
  assert.equal(fs.existsSync(SELF_MEMORY_PATH), false,
    "a background job that silently edits the notebook is not something to default on");
});

test("applying writes tagged bullets", () => {
  applyConsolidation([DURABLE]);
  const body = readSelfMemory();
  assert.match(body, /pnpm/);
  assert.match(body, /\[consolidated\]/);
});

// --------------------------------------------------------------------------
// revert
// --------------------------------------------------------------------------

test("revert removes what it wrote and nothing else", () => {
  appendSelfMemory("a note the user wrote by hand");
  appendSelfMemory("a note the model chose to remember", { channel: "telegram" });
  applyConsolidation([DURABLE]);

  const { removed } = revertConsolidation();
  assert.equal(removed, 1);

  const body = readSelfMemory();
  assert.match(body, /by hand/, "hand-written notes survive");
  assert.match(body, /chose to remember/, "the model's own remember() survives");
  assert.doesNotMatch(body, /pnpm/, "the consolidated one is gone");
});

test("revert on an untouched notebook is a no-op, not an error", () => {
  assert.deepEqual(revertConsolidation().removed, 0);
  appendSelfMemory("just a hand-written note here");
  assert.equal(revertConsolidation().removed, 0);
  assert.match(readSelfMemory(), /hand-written/);
});

test("a day left with no bullets loses its heading too", () => {
  applyConsolidation([DURABLE]);
  revertConsolidation();
  assert.doesNotMatch(readSelfMemory(), /^## \d{4}-\d{2}-\d{2}/m,
    "an empty date heading is debris in a file that ships on every turn");
});

test("revert can be scoped to recent days", () => {
  applyConsolidation([DURABLE]);
  // A future `since` matches nothing, so today's entry stays.
  assert.equal(revertConsolidation({ since: "2099-01-01" }).removed, 0);
  assert.match(readSelfMemory(), /pnpm/);
});

// --------------------------------------------------------------------------
// the cost, made visible
// --------------------------------------------------------------------------

test("the notebook reports its own size, since every turn pays for it", () => {
  applyConsolidation([DURABLE]);
  appendSelfMemory("a hand-written one");
  const s = notebookSize();
  assert.ok(s.chars > 0);
  assert.ok(s.approx_tokens > 0);
  assert.equal(s.consolidated, 1, "how much of the tax is machine-written");
  assert.ok(s.entries >= 2);
});
