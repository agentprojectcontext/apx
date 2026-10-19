import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fakeDesktopTrash } from "./fake-desktop-trash.ts";

test("the fake trash refuses traversal and symlinks outside its temp project before recording or moving", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-fake-trash-"));
  const root = path.join(temp, "project");
  const outside = path.join(temp, "outside");
  const record = path.join(temp, "trash.jsonl");
  const fakeTrash = `${record}.trash`;
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  const source = path.join(outside, "secret.txt");
  fs.writeFileSync(source, "keep me");
  fs.symlinkSync(outside, path.join(root, "escape"));
  const trash = fakeDesktopTrash(root, record);

  try {
    await assert.rejects(trash(path.join(root, "..", "outside", "secret.txt")), /outside the e2e project/);
    await assert.rejects(trash(path.join(root, "escape", "secret.txt")), /outside the e2e project/);
    assert.equal(fs.readFileSync(source, "utf8"), "keep me");
    assert.equal(fs.existsSync(record), false, "rejected paths are never recorded");
    assert.equal(fs.existsSync(fakeTrash), false, "rejected paths never create a trash destination");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
