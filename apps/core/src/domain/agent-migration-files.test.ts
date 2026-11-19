import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { inventoryMigrationFiles } from "./agent-migration-files.ts";

test("work file inventory is explicit, content-bound and read-only", async () => {
  const dir = tempDir("apx-migration-files-");
  const source = path.join(dir.path, "acme");
  const destination = path.join(dir.path, "northwind");
  fs.mkdirSync(path.join(source, "reports"), { recursive: true });
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(source, "reports", "summary.md"), "Check the references.\n");
  fs.writeFileSync(path.join(source, "unrelated.md"), "Other work");
  try {
    const inventory = inventoryMigrationFiles(source, destination, ["reports"]);
    assert.equal(inventory.files.length, 1);
    assert.equal(inventory.files[0]?.from, "reports/summary.md");
    assert.equal(inventory.files[0]?.to, "reports/summary.md");
    assert.equal(inventory.bytes, Buffer.byteLength("Check the references.\n"));
    assert.deepEqual(fs.readdirSync(destination), []);
    assert.doesNotMatch(JSON.stringify(inventory), /Check the references|Other work/);
    assert.deepEqual(inventoryMigrationFiles(source, destination, []).files, []);
    fs.writeFileSync(path.join(source, "reports", "summary.md"), "Changed references.\n");
    assert.notEqual(inventoryMigrationFiles(source, destination, ["reports"]).revision, inventory.revision);
    fs.mkdirSync(path.join(destination, "reports"));
    assert.throws(() => inventoryMigrationFiles(source, destination, ["reports"]), /already exists/);
  } finally {
    await dir.remove();
  }
});

test("work file inventory refuses traversal, credentials, linked folders and nested projects", async () => {
  const dir = tempDir("apx-migration-file-boundary-");
  const source = path.join(dir.path, "acme");
  const destination = path.join(dir.path, "northwind");
  fs.mkdirSync(source);
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(source, ".env"), "EXAMPLE=not-a-secret");
  fs.mkdirSync(path.join(source, "nested"));
  fs.symlinkSync(destination, path.join(source, "linked"), "junction");
  try {
    for (const selection of ["../northwind", "..\\northwind", ".", ".env", ".apc", "linked"])
      assert.throws(() => inventoryMigrationFiles(source, destination, [selection]));
    assert.throws(() => inventoryMigrationFiles(source, source, []), /separate/);
    assert.throws(() => inventoryMigrationFiles(source, path.join(source, "nested"), []), /separate/);
    assert.deepEqual(fs.readdirSync(destination), []);
  } finally {
    await dir.remove();
  }
});
