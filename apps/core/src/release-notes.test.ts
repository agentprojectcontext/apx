import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { changesIn, compareVersions, localReleases, notesFromGit, previousTag, sentence } from "./release-notes.ts";

test("versions compare by number, with or without their v and a build suffix", () => {
  assert.ok(compareVersions("v2.3.9", "2.3.10") < 0);
  assert.equal(compareVersions("2.3.32-dev.4+abc", "v2.3.32"), 0);
  assert.equal(previousTag("v2.3.10", ["v2.3.9", "v2.3.10", "v2.3.11", "v1.9.0"]), "v2.3.9");
});

test("each commit people read becomes a sentence; chores are left out", () => {
  assert.equal(sentence("fix(core): a chat turn gets 60 steps"), "A chat turn gets 60 steps");
  assert.equal(sentence("feat: apx chat shows the step limit"), "apx chat shows the step limit");
  const log =
    "abc1234\0feat(web): mark every chat read\x1e\ndef5678\0chore: tidy\x1e\n0a1b2c3\0perf!: faster lists\x1e";
  assert.deepEqual(changesIn(log), [
    { kind: "feat", text: "Mark every chat read", sha: "abc1234" },
    { kind: "perf", text: "Faster lists", sha: "0a1b2c3" },
  ]);
});

test("a checkout reads each release's notes from its tags, newest first", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-notes-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir, stdio: "pipe" });
  try {
    git("init", "-q", "-b", "release/v2");
    const commit = (subject: string) => git("commit", "-q", "--allow-empty", "-m", subject);
    commit("feat: first");
    git("tag", "v2.0.0");
    commit("fix(core): the inbox scrolls");
    commit("chore: tidy");
    git("tag", "v2.0.1");
    commit("feat(web): a what's new chat");
    git("tag", "v2.1.0");
    commit("fix: not released yet");

    const notes = notesFromGit(dir);
    assert.equal(notes?.version, "2.1.0", "the last tag the checkout is past");
    assert.equal(notes?.branch, "release/v2");
    assert.deepEqual(
      notes?.releases.map((r) => [r.version, r.previous, r.changes.map((c) => c.text)]),
      [
        ["2.1.0", "2.0.1", ["A what's new chat"]],
        ["2.0.1", "2.0.0", ["The inbox scrolls"]],
        ["2.0.0", undefined, []],
      ],
    );
    assert.equal(localReleases(dir).version(), "2.1.0");
    assert.equal(localReleases(dir).notes()?.repo_dir, dir);

    // A packaged build reads the file it carries, never git.
    fs.writeFileSync(path.join(dir, "release-notes.json"), JSON.stringify({ version: "9.0.0", releases: [] }));
    assert.equal(localReleases(dir).version(), "9.0.0");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("outside git there is no release to tell", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-notes-"));
  try {
    assert.equal(localReleases(dir).version(), undefined);
    assert.equal(localReleases(dir).notes(), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
