import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
let plain = "";
let project = "";
const sh = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-git-repo-")));
  plain = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-git-plain-")));
  sh("init", "-q", "-b", "main");
  // Git for Windows converts line endings by default; this repo keeps files byte for byte everywhere.
  sh("config", "core.autocrlf", "false");
  sh("config", "user.name", "Acme Dev");
  sh("config", "user.email", "dev@example.com");
  sh("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "feat: first");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(repo);
  await removeDir(plain);
});

test("a folder outside git says so instead of failing", async () => {
  const id = (await env.client.call("projects.register", { path: plain, init: true })).project.id;
  const s = await env.client.call("git.status", { project: id });
  assert.equal(s.repo, false);
});

test("changes are staged, unstaged and committed; the history lists the commit and what it changed", async () => {
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  fs.writeFileSync(path.join(repo, "new file.md"), "hi\n");
  let s = await env.client.call("git.status", { project });
  assert.equal(s.branch, "main");
  assert.deepEqual(
    s.unstaged.map((f) => [f.path, f.status]),
    [
      ["a.txt", "M"],
      ["new file.md", "?"],
    ],
  );
  assert.equal(s.unstaged[0]?.added, 1);
  assert.match((await env.client.call("git.diff", { project, path: "new file.md" })).diff, /\+hi/);

  await env.client.call("git.stage", { project, paths: ["a.txt", "new file.md"] });
  s = await env.client.call("git.status", { project });
  assert.deepEqual(s.staged.map((f) => f.path).sort(), ["a.txt", "new file.md"]);
  assert.equal(s.unstaged.length, 0);
  assert.match((await env.client.call("git.diff", { project, path: "a.txt", staged: true })).diff, /\+two/);

  await env.client.call("git.unstage", { project, paths: ["new file.md"] });
  s = await env.client.call("git.status", { project });
  assert.deepEqual(
    s.staged.map((f) => f.path),
    ["a.txt"],
  );

  const { sha } = await env.client.call("git.commit", { project, message: "fix: second\n\nThe body." });
  const log = await env.client.call("git.log", { project, limit: 1 });
  assert.equal(log.commits[0]?.sha, sha);
  assert.equal(log.commits[0]?.subject, "fix: second");
  assert.ok(log.commits[0]?.refs.includes("main"));
  assert.equal(log.more, true);
  const shown = await env.client.call("git.show", { project, sha });
  assert.equal(shown.body, "The body.");
  assert.deepEqual(
    shown.files.map((f) => [f.path, f.status, f.added]),
    [["a.txt", "M", 1]],
  );
  assert.match((await env.client.call("git.commit_diff", { project, sha, path: "a.txt" })).diff, /\+two/);
  // The first commit is compared with nothing.
  const first = (await env.client.call("git.log", { project })).commits.at(-1)?.sha ?? "";
  assert.equal((await env.client.call("git.show", { project, sha: first })).files.length, 2);
});

test("nothing outside the repository or inside .git; an empty commit is refused with git's reason", async () => {
  await assert.rejects(env.client.call("git.stage", { project, paths: ["../x"] }), /outside the repository/);
  await assert.rejects(env.client.call("git.stage", { project, paths: [".git/config"] }), /outside the repository/);
  await assert.rejects(env.client.call("git.diff", { project, path: "/etc/hosts" }), /outside the repository/);
  await assert.rejects(env.client.call("git.commit", { project, message: "chore: nothing" }), /nothing/);
});

test("branches are listed, made and switched; stash and undo keep the work; push without a remote says why", async () => {
  sh("commit", "-q", "--allow-empty", "-m", "chore: base");
  await env.client.call("git.checkout", { project, branch: "feat/cart", create: true });
  let b = await env.client.call("git.branches", { project });
  assert.equal(b.current, "feat/cart");
  assert.deepEqual(b.local, ["feat/cart", "main"]);
  await env.client.call("git.checkout", { project, branch: "main" });
  assert.equal((await env.client.call("git.branches", { project })).current, "main");

  fs.writeFileSync(path.join(repo, "a.txt"), "stashed\n");
  await env.client.call("git.run", { project, action: "stash" });
  assert.equal((await env.client.call("git.status", { project })).unstaged.length, 0);
  await env.client.call("git.run", { project, action: "stash_pop" });
  assert.equal(fs.readFileSync(path.join(repo, "a.txt"), "utf8"), "stashed\n");

  await env.client.call("git.stage", { project, paths: ["a.txt"] });
  await env.client.call("git.commit", { project, message: "fix: undo me" });
  await env.client.call("git.run", { project, action: "undo_commit" });
  const s = await env.client.call("git.status", { project });
  assert.deepEqual(
    s.staged.map((f) => f.path),
    ["a.txt"],
  );
  assert.notEqual((await env.client.call("git.log", { project, limit: 1 })).commits[0]?.subject, "fix: undo me");
  await assert.rejects(env.client.call("git.run", { project, action: "push" }), /origin/);
  // With no auxiliary model set up there is no suggestion, and nothing breaks.
  assert.equal((await env.client.call("git.suggest_message", { project })).message, "");
  b = await env.client.call("git.branches", { project });
  assert.deepEqual(b.remote, []);
});

test("commit all and amend, merge, rename and delete branches, and the history carries each commit's parents", async () => {
  fs.writeFileSync(path.join(repo, "all.txt"), "new\n");
  await env.client.call("git.commit", { project, message: "feat: all at once", all: true });
  assert.equal((await env.client.call("git.status", { project })).unstaged.length, 0);
  await env.client.call("git.commit", { project, message: "feat: all at once, amended", amend: true });
  let log = await env.client.call("git.log", { project, limit: 2 });
  assert.equal(log.commits[0]?.subject, "feat: all at once, amended");
  assert.equal(log.commits[0]?.parents[0], log.commits[1]?.sha);

  await env.client.call("git.checkout", { project, branch: "feat/side", create: true });
  fs.writeFileSync(path.join(repo, "side.txt"), "side\n");
  await env.client.call("git.commit", { project, message: "feat: side", all: true });
  await env.client.call("git.checkout", { project, branch: "main" });
  fs.writeFileSync(path.join(repo, "main.txt"), "main\n");
  await env.client.call("git.commit", { project, message: "feat: main", all: true });
  await env.client.call("git.branch", { project, op: "merge", branch: "feat/side" });
  log = await env.client.call("git.log", { project, limit: 10 });
  assert.ok(log.commits.some((c) => c.parents.length === 2 && c.refs.includes("main")));
  await env.client.call("git.branch", { project, op: "delete", branch: "feat/side" });
  await env.client.call("git.checkout", { project, branch: "fix/one", create: true, from: "main" });
  await env.client.call("git.branch", { project, op: "rename", branch: "fix/two" });
  assert.equal((await env.client.call("git.branches", { project })).current, "fix/two");
  await env.client.call("git.checkout", { project, branch: "main" });
  await assert.rejects(env.client.call("git.branch", { project, op: "delete_remote", branch: "nope" }), /remote/);
});

test("a folder holding several repositories lists them, and each one is worked by its path", async () => {
  const mono = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-git-mono-")));
  try {
    for (const name of ["apps/site", "tools/cli"]) {
      const dir = path.join(mono, name);
      fs.mkdirSync(dir, { recursive: true });
      execFileSync("git", ["init", "-q", "-b", "main", dir]);
      fs.writeFileSync(path.join(dir, "README.md"), `# ${name}\n`);
    }
    fs.mkdirSync(path.join(mono, "node_modules", "dep"), { recursive: true });
    execFileSync("git", ["init", "-q", path.join(mono, "node_modules", "dep")]);
    const id = (await env.client.call("projects.register", { path: mono, init: true })).project.id;
    const { repos } = await env.client.call("git.repos", { project: id });
    assert.deepEqual(
      repos.map((r) => r.path),
      ["apps/site", "tools/cli"],
    );
    assert.equal((await env.client.call("git.status", { project: id })).repo, false);
    const site = await env.client.call("git.status", { project: id, repo: "apps/site" });
    assert.deepEqual(
      site.unstaged.map((f) => f.path),
      ["README.md"],
    );
    await assert.rejects(env.client.call("git.status", { project: id, repo: "../" }), /outside the project/);
  } finally {
    await removeDir(mono);
  }
});

test("a repository with no commits yet has an empty history", async () => {
  const fresh = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-git-fresh-")));
  try {
    execFileSync("git", ["init", "-q", "-b", "main", fresh]);
    const id = (await env.client.call("projects.register", { path: fresh, init: true })).project.id;
    assert.deepEqual(await env.client.call("git.log", { project: id }), { commits: [], more: false });
  } finally {
    await removeDir(fresh);
  }
});
