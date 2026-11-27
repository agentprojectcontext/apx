import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore } from "../domain/store.ts";
import { deletionCard } from "../engine/owner-words.ts";
import { tempDir } from "../testkit/platform.ts";
import { deletes, deletionTargets, losesWork } from "./command-deletions.ts";

const FILES = ["Dockerfile", "LICENSE", "pnpm-lock.yaml"];
const CLEANUP =
  "git -C .worktrees/local-auth restore --worktree -- Dockerfile LICENSE pnpm-lock.yaml && git worktree remove .worktrees/local-auth && git branch -d fix/local-auth";

/** A project whose `.worktrees/local-auth` is a repository with three committed files. */
function project() {
  const dir = tempDir("apx-deletions-");
  const repo = path.join(dir.path, ".worktrees", "local-auth");
  fs.mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Acme", "-c", "user.email=user@example.com", "-C", repo, ...args], {
      stdio: "ignore",
    });
  git("init", "-q");
  for (const f of FILES) fs.writeFileSync(path.join(repo, f), `${f}\n`);
  git("add", ".");
  git("commit", "-q", "-m", "chore: start");
  return { dir, repo, git };
}

test("a restore that brings back files deleted in the working tree loses nothing: no deletion card", async () => {
  const { dir, repo } = project();
  await using _ = dir;
  for (const f of FILES) fs.rmSync(path.join(repo, f));
  assert.equal(losesWork(CLEANUP, dir.path), false);
  // Only what git itself refuses when work would be lost is left, and that never asks by itself.
  assert.deepEqual(deletionTargets(CLEANUP, dir.path).git, [
    { what: "worktree", target: repo, soft: true },
    { what: "branch", target: "fix/local-auth", soft: true, in: dir.path },
  ]);
  assert.equal(losesWork("git -C .worktrees/local-auth checkout -- LICENSE", dir.path), false);
  assert.equal(losesWork("git -C .worktrees/local-auth restore .", dir.path), false, "a clean tree loses nothing");
});

test("a restore over real edits still counts, and names only the edited files, where git runs (`-C`)", async () => {
  const { dir, repo, git } = project();
  await using _ = dir;
  fs.writeFileSync(path.join(repo, "Dockerfile"), "edited\n");
  fs.rmSync(path.join(repo, "LICENSE"));
  assert.equal(losesWork(CLEANUP, dir.path), true);
  assert.deepEqual(deletionTargets(CLEANUP, dir.path).git, [
    { what: "changes", target: path.join(repo, "Dockerfile") },
    { what: "worktree", target: repo, soft: true },
    { what: "branch", target: "fix/local-auth", soft: true, in: dir.path },
  ]);
  // A staged new file goes when the index is restored too.
  fs.writeFileSync(path.join(repo, "new.txt"), "new\n");
  git("add", "new.txt");
  assert.equal(losesWork("git -C .worktrees/local-auth restore --staged --worktree new.txt", dir.path), true);
  assert.equal(losesWork("git -C .worktrees/local-auth restore new.txt", dir.path), false);
});

test("paths of a git command are read from its -C folder, also when git cannot say what they hold", () => {
  const cwd = path.resolve("/work/acme");
  const unknown = () => undefined;
  assert.deepEqual(deletionTargets(CLEANUP, cwd, unknown).git, [
    ...FILES.map((f) => ({ what: "changes", target: path.join(cwd, ".worktrees", "local-auth", f) })),
    { what: "worktree", target: path.join(cwd, ".worktrees", "local-auth"), soft: true },
    { what: "branch", target: "fix/local-auth", soft: true, in: cwd },
  ]);
  assert.deepEqual(deletionTargets("cd sub && git -C a -C b clean -f x", cwd, unknown).git, [
    { what: "untracked", target: path.join(cwd, "sub", "a", "b", "x") },
  ]);
  assert.equal(losesWork(CLEANUP, cwd, unknown), true, "unknown edits count as lost");
});

test("the deletion card lists what goes in plain words, relative to the project, with no empty reason", async () => {
  await using dir = tempDir("apx-deletion-card-");
  const db = openDb(dir.path);
  // Closed before its folder goes (disposed in reverse): Windows cannot remove an open database.
  using _closed = { [Symbol.dispose]: () => db.close() };
  const store = createStore(db, createBus());
  const root = path.resolve("/work/acme");
  const card = deletionCard(store, { ...deletionTargets(CLEANUP, root, () => undefined), root }, undefined, CLEANUP);
  assert.deepEqual(card.deletion, {
    items: [
      "Cambios sin guardar en 3 archivos de .worktrees/local-auth (Dockerfile, LICENSE, pnpm-lock.yaml)",
      "La carpeta de trabajo .worktrees/local-auth (git no la borra si tiene cambios sin guardar)",
      "La rama fix/local-auth (git no la borra si tiene trabajo sin mergear)",
    ],
    // The parts that delete, one per line; the channels' text keeps the whole command.
    command: CLEANUP.split(" && ").join("\n"),
  });
  assert.doesNotMatch(card.detail, /no lo dijo|Por qué/);
  assert.match(card.detail, /^Comando: git -C .*git branch -d fix\/local-auth$/m);
  // A deletion chained after other work: the card shows only the part that deletes.
  const chained = "pnpm test && rm -rf 'old drafts' && echo done";
  assert.equal(
    deletionCard(store, { ...deletionTargets(chained, root), root }, undefined, chained).deletion.command,
    "rm -rf 'old drafts'",
  );
  store.settings.set("owner_language", "en");
  const forced = deletionCard(
    store,
    { paths: [path.join(root, "build")], later: [], git: [{ what: "branch", target: "fix/old" }], root },
    " Old build output. ",
    "rm -rf build && git branch -D fix/old",
  );
  assert.deepEqual(forced.deletion, {
    items: ["build", "The branch fix/old, even with work not merged"],
    reason: "Old build output.",
    command: "rm -rf build && git branch -D fix/old",
  });
  assert.match(forced.detail, /^Why: Old build output\.$/m);
});

test("find and xargs are deletions when their rm is forced or recursive, as rm alone (DECISIONS.md#d-266)", () => {
  for (const command of ["find . -name '*.log' -exec rm -f {} +", "ls logs | xargs -I{} rm -rf logs/{}"]) {
    assert.equal(deletes(command), true, command);
    assert.deepEqual(deletionTargets(command, "/work/acme").later.length, 1, command);
  }
  for (const command of ["find . -name '*.log' -delete", "find logs -exec rm {} \\;", "ls logs | xargs rm"])
    assert.equal(deletes(command), false, command);
});
