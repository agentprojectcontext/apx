import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { insideReal, realpath } from "../paths.ts";
import { guarded, namesAgentFiles, pathsOf } from "./paths.ts";

test("paths: inside means inside once links are resolved; git, agent files and AGENTS.md are guarded, a worktree under .agent is not", () => {
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
    assert.ok(guarded(root, ".agent/agents/me.md"));
    assert.ok(guarded(root, "AGENTS.md"));
    assert.ok(!guarded(root, "src/AGENTS.md"));
    assert.ok(!guarded(root, ".agent/worktree/issue-1/src/a.ts"), "a worktree kept under .agent is code");
    assert.ok(!guarded(root, ".agent/worktrees/fix-1/src/a.ts"));
    assert.ok(guarded(root, ".agent/project.json"));
    // Until it is moved, .apc/ holds the same definitions: an edit there could raise an agent's autonomy on the move.
    assert.ok(guarded(root, ".apc/agents/me.md"));
    assert.ok(!guarded(root, ".apc/worktrees/fix-1/src/a.ts"));
    assert.ok(namesAgentFiles("repo/.agent/agents/me.md"));
    assert.ok(namesAgentFiles(".apc/project.json"));
    assert.ok(namesAgentFiles("docs/AGENTS.md"));
    assert.ok(!namesAgentFiles(".agent/worktrees/x/a.ts"));
    assert.ok(!namesAgentFiles("src/agent/index.ts"), "a folder named agent without the dot is code");
    // Claude Code's permission files would let a session widen itself (DECISIONS.md#d-271).
    assert.ok(guarded(root, ".claude/settings.json"));
    assert.ok(guarded(root, ".claude/settings.local.json"));
    assert.ok(!guarded(root, ".claude/agents/reviewer.md"));
    assert.ok(namesAgentFiles("repo/.claude/settings.local.json"));
    assert.ok(!namesAgentFiles("repo/.claude/commands/ship.md"));
    assert.deepEqual(pathsOf({ filePath: "a", locations: [{ path: "b" }, { line: 3 }] }), ["a", "b"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
