import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fakeDesktopTrash } from "../e2e/fake-desktop-trash.ts";

test("the fake trash moves top-level files but refuses the project root", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-fake-trash-root-"));
  const root = path.join(temp, "project");
  const record = path.join(temp, "trash.jsonl");
  fs.mkdirSync(root);
  const source = path.join(root, "top-level.txt");
  const trash = fakeDesktopTrash(root, record);
  try {
    await assert.rejects(trash(root), /outside the e2e project/);
    assert.equal(fs.existsSync(record), false);
    assert.equal(fs.existsSync(`${record}.trash`), false);
    fs.writeFileSync(source, "top-level content");
    await trash(source);
    assert.equal(fs.existsSync(source), false);
    const [entry, ...more] = fs.readdirSync(`${record}.trash`);
    assert.ok(entry);
    assert.deepEqual(more, []);
    assert.equal(fs.readFileSync(path.join(`${record}.trash`, entry), "utf8"), "top-level content");
    assert.equal(fs.readFileSync(record, "utf8"), `${JSON.stringify(source)}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

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
    const inside = path.join(root, "inside.txt");
    const outsideLink = path.join(outside, "inward-link");
    fs.writeFileSync(inside, "inside content");
    fs.symlinkSync(inside, outsideLink);
    await assert.rejects(trash(outsideLink), /outside the e2e project/);
    assert.equal(fs.lstatSync(outsideLink).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(inside, "utf8"), "inside content");
    assert.equal(fs.readFileSync(source, "utf8"), "keep me");
    assert.equal(fs.existsSync(record), false, "rejected paths are never recorded");
    assert.equal(fs.existsSync(fakeTrash), false, "rejected paths never create a trash destination");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
