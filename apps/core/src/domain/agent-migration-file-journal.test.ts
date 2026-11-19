import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import {
  applyFileJournal,
  commitFileJournal,
  type FileJournal,
  prepareFileJournal,
} from "./agent-migration-file-journal.ts";

test("file journal resumes a partial move and reverses it without losing binary contents", async () => {
  const dir = tempDir("apx-file-journal-");
  const source = path.join(dir.path, "acme");
  const destination = path.join(dir.path, "northwind");
  const recovery = path.join(dir.path, "private", "move");
  fs.mkdirSync(source);
  fs.mkdirSync(destination);
  const bytes = new Uint8Array([0, 1, 255, 3]);
  fs.writeFileSync(path.join(source, "report.bin"), bytes);
  try {
    const prepared = prepareFileJournal(recovery, "migration_example", source, destination);
    prepared.change("source", "report.bin", null);
    prepared.change("destination", "report.bin", bytes);
    prepared.persist();
    fs.unlinkSync(path.join(source, "report.bin"));
    const resumed = JSON.parse(fs.readFileSync(path.join(recovery, "journal.json"), "utf8")) as FileJournal;
    applyFileJournal(recovery, resumed);
    assert.equal(resumed.state, "applied");
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(destination, "report.bin"))), bytes);
    assert.equal(fs.existsSync(path.join(source, "report.bin")), false);
    commitFileJournal(recovery, resumed);
    assert.equal(resumed.state, "committed");
    applyFileJournal(recovery, resumed, true);
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(source, "report.bin"))), bytes);
    assert.equal(fs.existsSync(path.join(destination, "report.bin")), false);
    applyFileJournal(recovery, resumed, true);
    assert.equal(resumed.state, "recovered");
  } finally {
    await dir.remove();
  }
});

for (const keepNewWork of [false, true]) {
  test(`recovery removes only newly-created empty folders and preserves unrelated work (${keepNewWork})`, async () => {
    const dir = tempDir("apx-file-folders-");
    const source = path.join(dir.path, "acme");
    const destination = path.join(dir.path, "northwind");
    const recovery = path.join(dir.path, "private", "move");
    fs.mkdirSync(source);
    fs.mkdirSync(path.join(destination, "reports"), { recursive: true });
    try {
      const prepared = prepareFileJournal(recovery, "migration_example", source, destination);
      prepared.change("destination", "reports/new/nested/report.txt", new TextEncoder().encode("Example report"));
      prepared.persist();
      applyFileJournal(recovery, prepared.journal);
      if (keepNewWork) fs.writeFileSync(path.join(destination, "reports/new/unrelated.txt"), "Keep this work");
      const reopened = JSON.parse(fs.readFileSync(path.join(recovery, "journal.json"), "utf8")) as FileJournal;
      applyFileJournal(recovery, reopened, true);
      assert.equal(fs.existsSync(path.join(destination, "reports/new/nested")), false);
      assert.equal(fs.existsSync(path.join(destination, "reports/new")), keepNewWork);
      assert.equal(fs.existsSync(path.join(destination, "reports")), true, "pre-existing folders are preserved");
      if (keepNewWork)
        assert.equal(fs.readFileSync(path.join(destination, "reports/new/unrelated.txt"), "utf8"), "Keep this work");
      applyFileJournal(recovery, reopened, true);
    } finally {
      await dir.remove();
    }
  });
}

test("file recovery refuses newer destination work and leaves all files untouched", async () => {
  const dir = tempDir("apx-file-journal-conflict-");
  const source = path.join(dir.path, "acme");
  const destination = path.join(dir.path, "northwind");
  const recovery = path.join(dir.path, "private", "move");
  fs.mkdirSync(source);
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(source, "report.txt"), "Old report");
  try {
    const prepared = prepareFileJournal(recovery, "migration_example", source, destination);
    prepared.change("source", "report.txt", null);
    prepared.change("destination", "report.txt", new TextEncoder().encode("Old report"));
    prepared.persist();
    applyFileJournal(recovery, prepared.journal);
    fs.writeFileSync(path.join(destination, "report.txt"), "New report");
    assert.throws(() => applyFileJournal(recovery, prepared.journal, true), /work file changed/);
    assert.equal(fs.readFileSync(path.join(destination, "report.txt"), "utf8"), "New report");
    assert.equal(fs.existsSync(path.join(source, "report.txt")), false);
  } finally {
    await dir.remove();
  }
});
