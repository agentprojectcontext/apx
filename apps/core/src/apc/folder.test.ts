import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { hasLegacyFolder, moveIfLegacy, moveLegacyFolder, needsFolderMove, ownDir, projectDir } from "./folder.ts";

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

/** A project as earlier versions left it: everything in .apc/, a git worktree in .apc/worktrees. */
function legacyProject(): string {
  const root = tempDir("apx-folder-").path;
  write(path.join(root, "AGENTS.md"), "# Northwind\n");
  write(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "Northwind", apx_id: "abc123def456" }));
  write(path.join(root, ".apc", "memory.md"), "Use metric units.\n");
  write(path.join(root, ".apc", "agents", "arch.md"), "---\nname: Arch\nrole: Architect\n---\n\nKeep it simple.\n");
  write(path.join(root, ".apc", "agents", ".archived", "old.md"), "---\nname: Old\n---\n");
  write(path.join(root, ".apc", "skills", "deploy", "SKILL.md"), "---\nname: deploy\n---\n");
  write(path.join(root, ".apc", "worktrees", "fix-1", "src", "a.ts"), "export {};\n");
  return root;
}

const tree = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else out[r.split(path.sep).join("/")] = fs.readFileSync(path.join(dir, r), "utf8");
    }
  };
  walk("");
  return out;
};

test("the move copies every file of .apc/ to .agent/, then leaves only its worktrees", async () => {
  const root = legacyProject();
  try {
    const before = tree(path.join(root, ".apc"));
    assert.ok(needsFolderMove(root));
    const r = moveLegacyFolder(root);
    assert.deepEqual(r, { files: 5, done: true, kept: ["worktrees"], conflicts: [] });
    const { "worktrees/fix-1/src/a.ts": worktree, ...definitions } = before;
    assert.deepEqual(tree(path.join(root, ".agent")), definitions);
    assert.deepEqual(tree(path.join(root, ".apc")), { "worktrees/fix-1/src/a.ts": worktree });
    assert.ok(!needsFolderMove(root) && !hasLegacyFolder(root));
    assert.ok(!fs.readdirSync(root).some((e) => e.startsWith(".agent.moving")), "the copy made aside is gone");
    assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "# Northwind\n", "AGENTS.md stays");
  } finally {
    await removeDir(root);
  }
});

test("the move is safe to run again, and finishes one cut after the copy", async () => {
  const root = legacyProject();
  try {
    moveLegacyFolder(root);
    const moved = tree(path.join(root, ".agent"));
    assert.deepEqual(moveLegacyFolder(root), { files: 0, done: true, kept: ["worktrees"], conflicts: [] });
    assert.deepEqual(tree(path.join(root, ".agent")), moved);

    // A run stopped after the copy: .agent/ is whole and .apc/ still has the same files.
    write(path.join(root, ".apc", "memory.md"), "Use metric units.\n");
    write(path.join(root, ".apc", "agents", "arch.md"), moved["agents/arch.md"] ?? "");
    assert.ok(hasLegacyFolder(root) && !needsFolderMove(root), ".agent/ is read; .apc/ only waits to be cleared");
    assert.deepEqual(moveLegacyFolder(root), { files: 2, done: true, kept: ["worktrees"], conflicts: [] });
    assert.deepEqual(tree(path.join(root, ".agent")), moved);
    assert.ok(!hasLegacyFolder(root));

    // Once its worktree is gone, the empty .apc/ goes too.
    await removeDir(path.join(root, ".apc", "worktrees", "fix-1"));
    assert.deepEqual(moveLegacyFolder(root), { files: 0, done: true, kept: [], conflicts: [] });
    assert.ok(!fs.existsSync(path.join(root, ".apc")));
  } finally {
    await removeDir(root);
  }
});

test("a file .agent/ already has with other content stops the move before anything is removed", async () => {
  const root = legacyProject();
  try {
    write(path.join(root, ".agent", "agents", "arch.md"), "---\nname: Arch\nautonomy: auto\n---\n");
    write(path.join(root, ".agent", "notes.md"), "mine\n");
    const before = tree(path.join(root, ".apc"));
    const r = moveLegacyFolder(root);
    assert.deepEqual(r.conflicts, ["agents/arch.md"]);
    assert.equal(r.done, false);
    assert.deepEqual(tree(path.join(root, ".apc")), before, ".apc/ is untouched");
    assert.equal(
      fs.readFileSync(path.join(root, ".agent", "agents", "arch.md"), "utf8"),
      "---\nname: Arch\nautonomy: auto\n---\n",
    );

    // The owner keeps theirs: the rest moves in beside what .agent/ had.
    fs.copyFileSync(path.join(root, ".agent", "agents", "arch.md"), path.join(root, ".apc", "agents", "arch.md"));
    assert.deepEqual(moveLegacyFolder(root), { files: 5, done: true, kept: ["worktrees"], conflicts: [] });
    assert.equal(fs.readFileSync(path.join(root, ".agent", "notes.md"), "utf8"), "mine\n");
    assert.equal(fs.readFileSync(path.join(root, ".agent", "memory.md"), "utf8"), "Use metric units.\n");
  } finally {
    await removeDir(root);
  }
});

test("a linked .apc/ or .agent/ is never moved through; a link inside is copied as a link", async () => {
  const root = legacyProject();
  const outside = tempDir("apx-folder-out-").path;
  try {
    write(path.join(outside, "secret.md"), "not the project's\n");
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(root, ".apc", "agents", "linked.md"));
    moveLegacyFolder(root);
    assert.ok(fs.lstatSync(path.join(root, ".agent", "agents", "linked.md")).isSymbolicLink());

    const other = legacyProject();
    try {
      fs.symlinkSync(outside, path.join(other, ".agent"), "junction");
      assert.throws(() => moveLegacyFolder(other), /\.agent is a link/);
      assert.ok(fs.existsSync(path.join(other, ".apc", "agents", "arch.md")));
    } finally {
      await removeDir(other);
    }
  } finally {
    await removeDir(root);
    await removeDir(outside);
  }
});

test("a project works from .apc/ until its move succeeds; a file named .agent in the way fails it", async () => {
  const root = legacyProject();
  try {
    assert.equal(ownDir(root), ".apc");
    write(path.join(root, ".agent"), "not a folder");
    assert.equal(ownDir(root), ".apc", "a stray file is not the project's folder");
    const failed = moveIfLegacy(root);
    assert.equal(failed?.state, "failed");
    assert.match(failed?.state === "failed" ? failed.error : "", /a file named \.agent is in the way/);
    assert.ok(fs.existsSync(path.join(root, ".apc", "agents", "arch.md")), ".apc/ is untouched");

    fs.rmSync(path.join(root, ".agent"));
    assert.deepEqual(moveIfLegacy(root), { state: "moved", files: 5, kept: ["worktrees"] });
    assert.equal(projectDir(root), path.join(root, ".agent"));
    assert.equal(moveIfLegacy(root), undefined, "nothing left to move, nothing to tell");
  } finally {
    await removeDir(root);
  }
});
