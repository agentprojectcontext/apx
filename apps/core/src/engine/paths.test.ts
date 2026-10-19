import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { insideReal, realpath } from "../paths.ts";
import { guarded, pathsOf } from "./paths.ts";

test("paths: inside means inside once links are resolved; git, APC and AGENTS.md are guarded, a worktree under .apc is not", () => {
  const root = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-paths-")));
  const outside = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-out-")));
  fs.mkdirSync(path.join(root, "src"));
  fs.symlinkSync(outside, path.join(root, "link"));
  try {
    assert.ok(insideReal(root, "src/new-file.ts"));
    assert.ok(insideReal(root, path.join(root, "src")));
    assert.ok(!insideReal(root, "../x"));
    assert.ok(!insideReal(root, "link/secret.txt"));
    assert.ok(!insideReal(root, "/etc/passwd"));
    assert.ok(guarded(root, ".git/config"));
    assert.ok(guarded(root, ".apc/agents/me.md"));
    assert.ok(guarded(root, "AGENTS.md"));
    assert.ok(!guarded(root, "src/AGENTS.md"));
    assert.ok(!guarded(root, ".apc/worktree/issue-1/src/a.ts"), "a worktree kept under .apc is code, not APC");
    assert.ok(guarded(root, ".apc/project.json"));
    assert.deepEqual(pathsOf({ filePath: "a", locations: [{ path: "b" }, { line: 3 }] }), ["a", "b"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
