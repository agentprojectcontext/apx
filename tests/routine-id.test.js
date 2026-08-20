// C1 — routines carry a stable `id`, and per-routine memory is keyed by it.
// A routine without one would fall back to routineMemoryDir()'s `_unknown`
// sentinel and share memory with every other routine.
// See docs-internal/secretary/00-findings.md § C1.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  upsertRoutine,
  listRoutines,
  getRoutine,
  getDueRoutines,
} from "#core/stores/routines.js";
import {
  appendRoutineMemory,
  readRoutineMemory,
  routineMemoryDir,
} from "#core/stores/routine-memory.js";

function tempStorage() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-routine-id-"));
}

const BASE = { kind: "heartbeat", schedule: "every:1h", spec: { message: "hi" } };

test("upsertRoutine assigns a stable id", () => {
  const dir = tempStorage();
  try {
    const r = upsertRoutine(dir, { ...BASE, name: "alpha" });
    assert.ok(r.id, "routine should have an id");
    assert.match(r.id, /^r_[a-z0-9]{6}$/, "id should use the shortId('r') shape");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The regression this fix could itself introduce: upsertRoutine rebuilds its
// `entry` object from scratch, so an edit must carry the previous id forward.
test("upsertRoutine keeps the same id when the routine is edited", () => {
  const dir = tempStorage();
  try {
    const first = upsertRoutine(dir, { ...BASE, name: "alpha" });
    const edited = upsertRoutine(dir, { ...BASE, name: "alpha", schedule: "every:2h" });

    assert.equal(edited.id, first.id, "editing must not re-id the routine");
    assert.equal(edited.schedule, "every:2h", "the edit should still apply");
    assert.equal(listRoutines(dir).length, 1, "editing must not duplicate the record");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("two routines get distinct ids and distinct memory directories", () => {
  const dir = tempStorage();
  try {
    const a = upsertRoutine(dir, { ...BASE, name: "alpha" });
    const b = upsertRoutine(dir, { ...BASE, name: "beta" });

    assert.notEqual(a.id, b.id);
    assert.notEqual(routineMemoryDir(dir, a.id), routineMemoryDir(dir, b.id));
    assert.ok(!routineMemoryDir(dir, a.id).endsWith("_unknown"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The actual user-visible bug: what one routine remembered leaked into every
// other routine's prompt.
test("routine memory does not leak between routines", () => {
  const dir = tempStorage();
  try {
    const a = upsertRoutine(dir, { ...BASE, name: "alpha" });
    const b = upsertRoutine(dir, { ...BASE, name: "beta" });

    appendRoutineMemory(dir, a.id, "alpha learned something", { routineName: "alpha" });

    assert.match(readRoutineMemory(dir, a.id), /alpha learned something/);
    assert.equal(readRoutineMemory(dir, b.id), "", "beta must not see alpha's memory");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("read entry points hand out records that carry an id", () => {
  const dir = tempStorage();
  try {
    upsertRoutine(dir, { name: "due-now", ...BASE });

    assert.ok(listRoutines(dir)[0].id, "listRoutines");
    assert.ok(getRoutine(dir, "due-now").id, "getRoutine");

    // BASE is every:1h, so upsertRoutine schedules the first run an hour out.
    const due = getDueRoutines(dir, new Date(Date.now() + 2 * 3600_000).toISOString());
    assert.equal(due.length, 1);
    assert.ok(due[0].id, "getDueRoutines — the runner keys memory off this");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
