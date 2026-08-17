// The guarantees these tests pin are the ones the six hand-rolled copies
// disagreed about: atomicity, permissions, and what a missing file returns.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  readJson,
  readJsonAsync,
  writeJson,
  writeJsonAsync,
  updateJson,
  SECRET_MODE,
} from "#core/util/json-file.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-json-"));
}

test("readJson: missing file returns the caller's fallback", () => {
  assert.equal(readJson("/no/such/file.json"), null);
  assert.deepEqual(readJson("/no/such/file.json", {}), {});
  assert.deepEqual(readJson("/no/such/file.json", []), []);
});

test("readJson: corrupt or empty content returns the fallback, never throws", () => {
  const dir = tmpDir();
  try {
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{ not json");
    assert.deepEqual(readJson(bad, { safe: true }), { safe: true });

    const empty = path.join(dir, "empty.json");
    fs.writeFileSync(empty, "   \n");
    assert.deepEqual(readJson(empty, { safe: true }), { safe: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeJson: round-trips, creates parent dirs, ends with a newline", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "nested", "deep", "x.json");
    writeJson(file, { a: 1, b: [2, 3] });
    assert.deepEqual(readJson(file), { a: 1, b: [2, 3] });
    assert.ok(fs.readFileSync(file, "utf8").endsWith("\n"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The reason the kernel exists: a reader must never observe a partial file, and
// a failed write must not destroy what was already there.
test("writeJson: leaves no temp file behind, and the target is complete", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "x.json");
    writeJson(file, { big: "x".repeat(50_000) });
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp"));
    assert.deepEqual(leftovers, [], "temp file must be renamed, not left");
    assert.equal(readJson(file).big.length, 50_000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeJson: a failed serialization leaves the previous file intact", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "x.json");
    writeJson(file, { keep: "me" });

    const circular = {};
    circular.self = circular;
    assert.throws(() => writeJson(file, circular));

    assert.deepEqual(readJson(file), { keep: "me" }, "previous value survives");
    assert.deepEqual(
      fs.readdirSync(dir).filter((f) => f.includes(".tmp")),
      [],
      "no temp file left behind on failure"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Not written as a conditional skip: this suite forbids skipped tests, and a
// skip would hide the assertion rather than adapt it. Windows has no POSIX
// mode bits, so there we assert the write still succeeds.
test("writeJson: SECRET_MODE makes the file owner-only", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "secret.json");
    writeJson(file, { token: "s3cr3t" }, { mode: SECRET_MODE });
    assert.deepEqual(readJson(file), { token: "s3cr3t" });
    if (process.platform === "win32") return;
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, SECRET_MODE, `expected 0600, got 0${mode.toString(8)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("updateJson: read-modify-write round trip", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "list.json");
    updateJson(file, (cur) => [...(cur || []), "a"], { fallback: [] });
    updateJson(file, (cur) => [...cur, "b"], { fallback: [] });
    assert.deepEqual(readJson(file), ["a", "b"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("async variants match the sync ones", async () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "a.json");
    await writeJsonAsync(file, { v: 1 });
    assert.deepEqual(await readJsonAsync(file), { v: 1 });
    assert.deepEqual(readJson(file), { v: 1 }, "sync reader agrees");
    assert.equal(await readJsonAsync("/no/such.json", "fb"), "fb");
    assert.deepEqual(
      fs.readdirSync(dir).filter((f) => f.includes(".tmp")),
      []
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
