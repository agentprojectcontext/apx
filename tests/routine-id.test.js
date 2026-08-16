// C1 — routines carry a stable `id`, and per-routine memory is keyed by it.
//
// Before this, upsertRoutine() never wrote an `id`, so routineMemoryDir() fell
// back to its `_unknown` sentinel and EVERY routine in the system shared one
// memory.md. See docs-internal/secretary/00-findings.md § C1.
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
  ensureRoutineIds,
} from "#core/stores/routines.js";
import {
  appendRoutineMemory,
  readRoutineMemory,
  routineMemoryDir,
} from "#core/stores/routine-memory.js";

function tempStorage() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-routine-id-"));
}

function writeLegacyRoutines(storagePath, routines) {
  fs.mkdirSync(storagePath, { recursive: true });
  fs.writeFileSync(
    path.join(storagePath, "routines.json"),
    JSON.stringify({ routines }, null, 2) + "\n"
  );
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

test("legacy records without an id are migrated and persisted", () => {
  const dir = tempStorage();
  try {
    writeLegacyRoutines(dir, [
      { name: "old-one", kind: "heartbeat", schedule: "every:1h", spec: {}, enabled: true },
      { name: "old-two", kind: "heartbeat", schedule: "every:2h", spec: {}, enabled: true },
    ]);

    const migrated = ensureRoutineIds(dir);
    assert.equal(migrated, 2);

    // Persisted, not just returned.
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "routines.json"), "utf8")).routines;
    assert.ok(onDisk.every((r) => r.id), "ids must be written to disk");
    assert.notEqual(onDisk[0].id, onDisk[1].id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration is idempotent and stops touching disk once ids exist", () => {
  const dir = tempStorage();
  try {
    writeLegacyRoutines(dir, [
      { name: "old-one", kind: "heartbeat", schedule: "every:1h", spec: {}, enabled: true },
    ]);

    assert.equal(ensureRoutineIds(dir), 1, "first pass migrates");
    const idAfterFirst = listRoutines(dir)[0].id;

    const file = path.join(dir, "routines.json");
    const mtimeBefore = fs.statSync(file).mtimeMs;

    assert.equal(ensureRoutineIds(dir), 0, "second pass is a no-op");
    assert.equal(fs.statSync(file).mtimeMs, mtimeBefore, "no-op must not rewrite the file");
    assert.equal(listRoutines(dir)[0].id, idAfterFirst, "ids must be stable across reads");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pre-existing routines/_unknown/ content is left untouched by the migration", () => {
  const dir = tempStorage();
  try {
    const orphan = path.join(dir, "routines", "_unknown");
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, "memory.md"), "# shared\n- something old\n");

    writeLegacyRoutines(dir, [
      { name: "old-one", kind: "heartbeat", schedule: "every:1h", spec: {}, enabled: true },
    ]);
    ensureRoutineIds(dir);

    assert.equal(
      fs.readFileSync(path.join(orphan, "memory.md"), "utf8"),
      "# shared\n- something old\n",
      "orphaned shared memory must be preserved verbatim"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("read entry points hand out records that carry an id", () => {
  const dir = tempStorage();
  try {
    writeLegacyRoutines(dir, [
      { name: "due-now", kind: "heartbeat", schedule: "every:1h", spec: {}, enabled: true },
    ]);

    assert.ok(listRoutines(dir)[0].id, "listRoutines");
    assert.ok(getRoutine(dir, "due-now").id, "getRoutine");

    const due = getDueRoutines(dir, new Date(Date.now() + 60_000).toISOString());
    assert.equal(due.length, 1);
    assert.ok(due[0].id, "getDueRoutines — the runner keys memory off this");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
