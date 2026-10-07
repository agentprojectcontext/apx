import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
let plain = "";
let project = "";
const sh = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-git-repo-")));
  plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-git-plain-")));
  sh("init", "-q", "-b", "main");
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
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(plain, { recursive: true, force: true });
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
