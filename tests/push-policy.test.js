// The push policy for `main` (AGENTS.md rule 19), pinned from both sides.
//
// A hook fails by doing nothing: a policy that lets everything through looks
// exactly like one that works. So each clause is asserted, and the CLI is run
// against a real throwaway git repo — the part that decides "does this commit
// already live on another branch" is git plumbing, and a mock of it would only
// prove the mock.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decide, parsePushLines, MAIN_REF } from "../scripts/push-policy.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "scripts", "push-policy.js");
const HOOK = path.join(REPO, ".githooks", "pre-push");

test("pushes that do not target main are not this policy's business", () => {
  const d = decide({ localRef: "refs/heads/feat/x", remoteRef: "refs/heads/feat/x", commits: [{ sha: "a", merge: false, elsewhere: false }] });
  assert.equal(d.allowed, true);
  assert.equal(d.gate, false);
});

test("a commit that exists only on main is refused, with the way out in the reason", () => {
  const d = decide({ localRef: "refs/heads/main", remoteRef: MAIN_REF, commits: [{ sha: "abcdef1234", merge: false, elsewhere: false }] });
  assert.equal(d.allowed, false);
  assert.match(d.reason, /abcdef1/);
  assert.match(d.reason, /hotfix\/<slug>|APX_HOTFIX=1/);
});

test("a merge from staging reaches main — through the e2e gate", () => {
  const d = decide({
    localRef: "refs/heads/main",
    remoteRef: MAIN_REF,
    commits: [
      { sha: "m1", merge: true, elsewhere: false },
      { sha: "c1", merge: false, elsewhere: true },
    ],
  });
  assert.equal(d.allowed, true);
  assert.equal(d.gate, true, "reaching main always runs the e2e gate");
});

test("a hotfix may skip staging but never the gate — by branch name or by env", () => {
  const byBranch = decide({ localRef: "refs/heads/hotfix/inbox-dialog", remoteRef: MAIN_REF, commits: [{ sha: "h", merge: false, elsewhere: false }] });
  assert.deepEqual([byBranch.allowed, byBranch.gate, byBranch.hotfix], [true, true, true]);
  const byEnv = decide({ localRef: "refs/heads/main", remoteRef: MAIN_REF, hotfixEnv: true, commits: [{ sha: "h", merge: false, elsewhere: false }] });
  assert.deepEqual([byEnv.allowed, byEnv.gate, byEnv.hotfix], [true, true, true]);
});

test("deleting main is refused even for a hotfix", () => {
  assert.equal(decide({ localRef: "(delete)", remoteRef: MAIN_REF, deleting: true, hotfixEnv: true }).allowed, false);
});

test("git's pre-push stdin is parsed line by line", () => {
  const lines = parsePushLines("refs/heads/a 111 refs/heads/main 222\n\nrefs/heads/b 333 refs/heads/b 000\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { localRef: "refs/heads/a", localSha: "111", remoteRef: "refs/heads/main", remoteSha: "222" });
});

test("the pre-push hook consults the policy and runs the e2e gate for main", () => {
  const hook = fs.readFileSync(HOOK, "utf8");
  assert.ok(fs.statSync(HOOK).mode & 0o111, ".githooks/pre-push must keep its executable bit");
  assert.match(hook, /scripts\/push-policy\.js/, "the hook asks the policy");
  assert.match(hook, /scripts\/e2e-gate\.js/, "the hook runs the e2e gate when the policy says so");
});

// ── The CLI against a real repository ───────────────────────────────────────

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-push-policy-"));
  const g = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "dev@example.com");
  g("config", "user.name", "Dev");
  g("config", "commit.gpgsign", "false");
  const commit = (msg) => {
    fs.writeFileSync(path.join(dir, `${msg.replace(/\W/g, "_")}.txt`), msg);
    g("add", "-A");
    g("-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", msg);
    return g("rev-parse", "HEAD");
  };
  return { dir, g, commit };
}

function runCli(dir, stdin, env = {}) {
  const out = spawnSync(process.execPath, [CLI], { cwd: dir, input: stdin, encoding: "utf8", env: { ...process.env, APX_HOTFIX: "", ...env } });
  return { code: out.status, stdout: out.stdout.trim(), stderr: out.stderr };
}

test("CLI: a commit made straight on main is refused; the same work via staging passes to the gate", () => {
  const { dir, g, commit } = repo();
  try {
    const base = commit("chore: base");
    const direct = commit("fix: straight on main");
    const refused = runCli(dir, `refs/heads/main ${direct} ${MAIN_REF} ${base}\n`);
    assert.equal(refused.code, 1, refused.stderr);
    assert.match(refused.stderr, /exist only on main/);

    const hot = runCli(dir, `refs/heads/main ${direct} ${MAIN_REF} ${base}\n`, { APX_HOTFIX: "1" });
    assert.equal(hot.code, 0, hot.stderr);
    assert.equal(hot.stdout.split("\n").pop(), "gate");

    g("reset", "-q", "--hard", base);
    g("checkout", "-q", "-b", "staging");
    commit("fix: on staging first");
    g("checkout", "-q", "main");
    g("-c", "core.hooksPath=/dev/null", "merge", "-q", "--no-ff", "-m", "Merge branch 'staging'", "staging");
    const tip = g("rev-parse", "HEAD");
    const merged = runCli(dir, `refs/heads/main ${tip} ${MAIN_REF} ${base}\n`);
    assert.equal(merged.code, 0, merged.stderr);
    assert.equal(merged.stdout.split("\n").pop(), "gate");

    const other = runCli(dir, `refs/heads/staging ${tip} refs/heads/staging ${base}\n`);
    assert.equal(other.code, 0);
    assert.equal(other.stdout.split("\n").pop(), "no-gate");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
