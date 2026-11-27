import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { deletionTargets } from "./command-deletions.ts";
import { type DeletionPlace, verdictOf, weighDeletion } from "./deletion-kinds.ts";

/** A project with a merged worktree and branch, an unmerged one, and an owner's file from before the task. */
function project() {
  const dir = tempDir("apx-weigh-");
  const repo = dir.path;
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Acme", "-c", "user.email=user@example.com", ...args], {
      cwd: repo,
      stdio: "ignore",
    });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "notes.md"), "the owner's\n");
  git("add", ".");
  git("commit", "-q", "-m", "chore: start");
  git("worktree", "add", "-q", ".worktrees/done", "-b", "fix/done");
  git("worktree", "add", "-q", ".worktrees/open", "-b", "feat/open");
  fs.writeFileSync(path.join(repo, ".worktrees", "open", "draft.md"), "unsaved\n");
  git("-C", ".worktrees/open", "add", "draft.md");
  git("-C", ".worktrees/open", "commit", "-q", "-m", "feat: draft");
  const place = (since = Date.now()): DeletionPlace => ({
    roots: [repo],
    scratch: path.join(repo, "..", `${path.basename(repo)}-scratch`),
    since,
    earlier: [],
  });
  return { dir, repo, place };
}

const verdict = (command: string, cwd: string, place: DeletionPlace) =>
  verdictOf(weighDeletion(deletionTargets(command, cwd), place));

test("cleaning a merged worktree and branch runs; unmerged work asks", async () => {
  const { dir, repo, place } = project();
  await using _ = dir;
  const at = place();
  assert.equal(verdict("git worktree remove --force .worktrees/done && git branch -D fix/done", repo, at), "run");
  assert.equal(verdict("git branch -D feat/open", repo, at), "ask", "a forced deletion of an unmerged branch");
  assert.equal(verdict("git worktree remove --force .worktrees/open", repo, at), "ask");
  // Files git does not keep are lost with a forced remove, merged or not.
  fs.writeFileSync(path.join(repo, ".worktrees", "done", "scratch.txt"), "x\n");
  assert.equal(verdict("git worktree remove --force .worktrees/done", repo, at), "ask");
});

test("build and test output, what the task made, the temp folder and what is gone run; the owner's files ask", async () => {
  const { dir, repo, place } = project();
  await using _ = dir;
  fs.mkdirSync(path.join(repo, "coverage", "all"), { recursive: true });
  fs.writeFileSync(path.join(repo, "coverage", "all", "lcov.info"), "x\n");
  const before = place();
  assert.equal(verdict("rm -r coverage", repo, before), "run");
  assert.equal(verdict("rm -rf node_modules/.cache dist", repo, before), "run");
  assert.equal(verdict("rm -rf never-made", repo, before), "run", "nothing there loses nothing");
  assert.equal(verdict("rm -f notes.md", repo, before), "ask", "the owner's file, older than the task");
  fs.mkdirSync(path.join(repo, "renders", "take-2"), { recursive: true });
  fs.writeFileSync(path.join(repo, "renders", "take-2", "a.mp4"), "x\n");
  assert.equal(verdict("rm -rf renders/take-2", repo, place(0)), "run", "made during the task");
  // One older file inside a folder made since keeps it the owner's.
  fs.renameSync(path.join(repo, "notes.md"), path.join(repo, "renders", "take-2", "notes.md"));
  assert.equal(verdict("rm -rf renders/take-2", repo, { ...before, since: Date.now() - 1 }), "ask");
  assert.equal(verdict(`rm -rf ${before.scratch}/x`, repo, before), "run");
  await using away = tempDir("apx-away-");
  fs.writeFileSync(path.join(away.path, "a.txt"), "x\n");
  assert.equal(verdict(`rm -f ${away.path}/a.txt`, repo, place(0)), "ask", "outside the owner's projects");
});

test("uncommitted work asks; a container this run started goes; what only the remote knows goes to the judge", async () => {
  const { dir, repo, place } = project();
  await using _ = dir;
  fs.writeFileSync(path.join(repo, "notes.md"), "edited\n");
  assert.equal(verdict("git checkout -- notes.md", repo, place()), "ask");
  assert.equal(verdict("git stash drop", repo, place()), "ask");
  const started = { ...place(), earlier: ["docker run -d --name apx-e2e-7 apx-ci:latest"] };
  assert.equal(verdict("docker rm -f apx-e2e-7", repo, started), "run");
  assert.equal(verdict("docker rm -f apx-other", repo, started), "judge");
  // A canceled CI run's leftovers on another machine: only the judge can tell (the real command, 2026-11-27).
  const homelab =
    'ssh homelab-vps \'tar -C "$HOME/apx-ci/slots/fix-x/coverage/all" -czf - logs\' > /tmp/logs.tgz && ssh homelab-vps \'docker rm apx-fix-x && rm -r "$HOME/apx-ci/slots/fix-x/coverage"; df -h "$HOME/apx-ci"\'';
  const d = deletionTargets(homelab, repo);
  assert.deepEqual(d.parts, [
    'ssh homelab-vps \'docker rm apx-fix-x && rm -r "$HOME/apx-ci/slots/fix-x/coverage"; df -h "$HOME/apx-ci"\'',
  ]);
  assert.equal(verdictOf(weighDeletion(d, place())), "judge");
});
