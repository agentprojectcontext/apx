import { test } from "node:test";
import assert from "node:assert/strict";
import { filterSessionsByQuery } from "#interfaces/cli/commands/sessions.js";

// Shared search core used by both `apx session find` (CLI) and the daemon's
// GET /sessions?q= endpoint. These cover the title-match path (no filesystem).

const rows = [
  { engine: "claude", id: "a", title: "Fix the web sidebar layout", mtime: 30, cwd: "/p1" },
  { engine: "codex",  id: "b", title: "Refactor the API client",    mtime: 20, cwd: "/p2" },
  { engine: "apx",    id: "c", title: "Improve the SIDEBAR styles", mtime: 10, cwd: "/p3" },
];

test("filterSessionsByQuery matches titles case-insensitively", () => {
  const out = filterSessionsByQuery(rows, { query: "sidebar" });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.id), ["a", "c"]);
  assert.ok(out.every((r) => r.match === "title"));
});

test("filterSessionsByQuery returns full rows newest-first", () => {
  const out = filterSessionsByQuery(rows, { query: "the" });
  assert.deepEqual(out.map((r) => r.mtime), [30, 20, 10]);
  // full row preserved (engine/id/cwd are needed by the web action buttons)
  assert.equal(out[0].engine, "claude");
  assert.equal(out[0].cwd, "/p1");
});

test("filterSessionsByQuery de-dupes by engine:id", () => {
  const dupes = [...rows, { engine: "claude", id: "a", title: "Fix the web sidebar layout", mtime: 99, cwd: "/p1" }];
  const out = filterSessionsByQuery(dupes, { query: "sidebar" });
  assert.equal(out.filter((r) => r.engine === "claude" && r.id === "a").length, 1);
});

test("filterSessionsByQuery honors limit and empty query", () => {
  assert.equal(filterSessionsByQuery(rows, { query: "the", limit: 1 }).length, 1);
  assert.deepEqual(filterSessionsByQuery(rows, { query: "" }), []);
  assert.deepEqual(filterSessionsByQuery(rows, { query: "   " }), []);
});
