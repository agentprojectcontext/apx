import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ExtensionSetting } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";
import { checkSettingFile } from "./setting-file.ts";

const setting = ExtensionSetting.parse({
  name: "backup",
  label: "SQLite backup",
  type: "file",
  fileFormat: "sqlite",
  required: true,
});
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

test("a standalone backup is checked without changing bytes or creating sidecars", () => {
  const dir = tempDir("apx-setting-file-");
  try {
    const file = path.join(dir.path, "backup.sqlite");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT)");
    db.close();
    const before = hash(file);
    checkSettingFile(setting, file);
    assert.equal(hash(file), before);
    assert.deepEqual(fs.readdirSync(dir.path), ["backup.sqlite"]);
  } finally {
    dir.remove();
  }
});

test("file validation distinguishes missing, directory, invalid header, corrupt schema and active backups without exposing paths", () => {
  const dir = tempDir("apx-setting-file-");
  const file = path.join(dir.path, "backup.sqlite");
  const fails = (target: string, reason: string) =>
    assert.throws(
      () => checkSettingFile(setting, target),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "shape" in error);
        assert.deepEqual(error.shape, {
          code: "bad_request",
          message: "Choose an existing, readable file",
          detail: { kind: "setting_file", setting: "backup", reason },
        });
        return true;
      },
    );
  try {
    fails(file, "missing");
    assert.equal(fs.existsSync(file), false);
    fails(dir.path, "missing");
    fs.writeFileSync(file, "not a database");
    fails(file, "invalid_sqlite");
    const header = Buffer.alloc(100);
    header.write("SQLite format 3\0");
    header[18] = 1;
    header[19] = 1;
    fs.writeFileSync(file, header);
    fails(file, "invalid_sqlite");
    fs.writeFileSync(`${file}-wal`, "active");
    fails(file, "active_sqlite");
    fs.unlinkSync(`${file}-wal`);
    header[18] = 2;
    fs.writeFileSync(file, header);
    fails(file, "active_sqlite");
    checkSettingFile(ExtensionSetting.parse({ name: "plain", label: "File", type: "file" }), file);
  } finally {
    dir.remove();
  }
});

test("the settings protocol refuses invalid SQLite atomically and accepts the unchanged valid backup", async () => {
  const home = tempDir("apx-file-home-");
  const src = tempDir("apx-file-source-");
  const core = await startCore({ home: home.path, llm: scriptedLlm(() => say("ok")) });
  try {
    fs.writeFileSync(
      path.join(src.path, "apx-extension.json"),
      JSON.stringify({ manifest: 2, id: "backup_test", name: "Backup test", version: "1.0.0", settings: [setting] }),
    );
    const inspected = await core.client.call("extensions.inspect", { path: src.path });
    const extension = await core.client.call("extensions.install", { path: src.path, hash: inspected.hash });
    const file = path.join(src.path, "backup.sqlite");
    fs.writeFileSync(file, "invalid");
    await assert.rejects(
      core.client.call("extensions.settings", { id: extension.id, values: { backup: file } }),
      (error: unknown) => {
        assert.ok(error instanceof ApxError);
        assert.deepEqual(error.detail, { kind: "setting_file", setting: "backup", reason: "invalid_sqlite" });
        return true;
      },
    );
    const rejected = (await core.client.call("extensions.list", {})).extensions.find(
      (item) => item.id === extension.id,
    );
    assert.ok(rejected);
    assert.equal(rejected.settings[0]?.set, false);
    fs.unlinkSync(file);
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE sample (id INTEGER)");
    db.close();
    const before = hash(file);
    await core.client.call("extensions.settings", { id: extension.id, values: { backup: file } });
    const accepted = (await core.client.call("extensions.list", {})).extensions.find(
      (item) => item.id === extension.id,
    );
    assert.ok(accepted);
    assert.equal(accepted.settings[0]?.value, file);
    assert.equal(hash(file), before);
  } finally {
    await core.core.close();
    src.remove();
    home.remove();
  }
});
