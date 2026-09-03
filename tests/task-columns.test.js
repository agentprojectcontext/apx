// Board columns: one global catalog, a per-project subset, `done` always last.
// See src/core/tasks/columns.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TASK_COLUMNS, DONE_COLUMN, columnFor, columnHook,
  isColumnId, normalizeColumns, projectColumns, readColumnCatalog,
} from "#core/tasks/columns.js";

const ids = (cols) => cols.map((c) => c.id);

test("the shipped catalog is exactly the statuses that existed before", () => {
  assert.deepEqual(ids(DEFAULT_TASK_COLUMNS), ["pending", "running", "in_review", "blocked"]);
});

test("isColumnId accepts slugs and refuses the reserved terminal column", () => {
  assert.ok(isColumnId("qa"));
  assert.ok(isColumnId("waiting-on-client"));
  assert.ok(!isColumnId("done"));       // reserved: every board ends with it
  assert.ok(!isColumnId("Con Espacio"));
  assert.ok(!isColumnId(""));
});

test("normalizeColumns drops the unusable instead of rejecting the lot", () => {
  const out = normalizeColumns([
    { id: "qa", label: "QA" },
    { id: "qa", label: "dupe" },        // duplicate → first wins
    { id: "done" },                     // reserved
    { id: "NO PUEDE" },                 // not slug-shaped
    "design",                           // a bare string is a valid shorthand
  ]);
  assert.deepEqual(ids(out), ["qa", "design"]);
  assert.equal(out[0].label, "QA");
  assert.equal(out[1].label, null);     // null = use the built-in translation
});

test("a catalog that normalizes to nothing falls back to the default", () => {
  // Showing no columns at all would read as a broken board, which is worse than
  // showing the ones we shipped with.
  assert.deepEqual(ids(normalizeColumns([{ id: "done" }])), ids(DEFAULT_TASK_COLUMNS));
  assert.deepEqual(ids(normalizeColumns("nonsense")), ids(DEFAULT_TASK_COLUMNS));
});

test("an on_enter hook needs an agent; an instruction alone is not a hook", () => {
  const [withAgent] = normalizeColumns([{ id: "qa", on_enter: { agent: "QA", instruction: " probá " } }]);
  assert.deepEqual(withAgent.on_enter, { agent: "qa", instruction: "probá" });

  const [noAgent] = normalizeColumns([{ id: "qa", on_enter: { instruction: "probá todo" } }]);
  assert.equal(noAgent.on_enter, undefined);

  const [bare] = normalizeColumns([{ id: "qa", on_enter: { agent: "qa" } }]);
  assert.deepEqual(bare.on_enter, { agent: "qa", instruction: null });

  assert.deepEqual(columnHook([withAgent], "qa"), { agent: "qa", instruction: "probá" });
  assert.equal(columnHook([withAgent], "nope"), null);
});

test("readColumnCatalog falls back when config says nothing", () => {
  assert.deepEqual(ids(readColumnCatalog({})), ids(DEFAULT_TASK_COLUMNS));
  assert.deepEqual(ids(readColumnCatalog({ tasks: { columns: [{ id: "qa" }] } })), ["qa"]);
});

test("a project that picked nothing shows the whole catalog, then done", () => {
  const cols = projectColumns({}, {});
  assert.deepEqual(ids(cols), ["pending", "running", "in_review", "blocked", DONE_COLUMN]);
});

test("a project shows its subset, in ITS order, and done is always last", () => {
  // This is the case the whole design exists for: the same vocabulary, two very
  // different boards. A personal list is one column and done.
  const global = { tasks: { columns: [{ id: "pending" }, { id: "running" }, { id: "qa", label: "QA" }] } };
  assert.deepEqual(
    ids(projectColumns(global, { tasks: { columns: ["qa", "pending"] } })),
    ["qa", "pending", DONE_COLUMN],
  );
  assert.deepEqual(
    ids(projectColumns(global, { tasks: { columns: ["pending"] } })),
    ["pending", DONE_COLUMN],
  );
});

test("a project cannot invent a column the catalog does not have", () => {
  // Otherwise "move it to QA" means a different thing per project, and the whole
  // point of a shared vocabulary is gone.
  const global = { tasks: { columns: [{ id: "pending" }] } };
  const cols = projectColumns(global, { tasks: { columns: ["pending", "invented"] } });
  assert.deepEqual(ids(cols), ["pending", DONE_COLUMN]);
});

test("a column removed from the catalog disappears from the boards that used it", () => {
  const global = { tasks: { columns: [{ id: "pending" }] } };
  const cols = projectColumns(global, { tasks: { columns: ["qa"] } });
  // Nothing valid was picked → the catalog stands in, rather than an empty board.
  assert.deepEqual(ids(cols), ["pending", DONE_COLUMN]);
});

test("columnFor finishes in done, but a dropped task stays where it was left", () => {
  const cols = projectColumns({ tasks: { columns: [{ id: "qa" }, { id: "pending" }] } }, {});
  assert.equal(columnFor({ state: "done", status: "qa" }, cols), DONE_COLUMN);
  assert.equal(columnFor({ state: "open", status: "qa" }, cols), "qa");

  // Dropped is NOT done. It was abandoned, and the useful thing to see when you
  // go looking at what you gave up on is WHERE you gave up. Filing it under
  // "done" would claim it was finished.
  assert.equal(columnFor({ state: "dropped", status: "qa" }, cols), "qa");

  // Its column was removed from this board — the card stays visible rather than
  // vanishing into a column that is not drawn.
  assert.equal(columnFor({ state: "open", status: "in_review" }, cols), "qa");
});
