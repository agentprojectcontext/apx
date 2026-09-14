// The commit-msg gate, pinned from both sides.
//
// A hook is the one kind of gate that fails by doing NOTHING: lose the
// executable bit, hardcode a type list that drifts from .releaserc.json, or
// tighten the pattern past what the history already contains, and there is no
// error anywhere — commits just stop being checked, or start being rejected
// for no reason. Both directions are asserted here.
//
// What it deliberately does NOT assert: that the type is the RIGHT one. A fix
// wearing `chore` is well-formed, ships no version, and is exactly the failure
// nothing mechanical can see. rules/releasing.md carries that half.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(REPO, ".githooks", "commit-msg");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-commit-msg-"));

/** Run the hook over one subject the way git does: a file path in argv[2]. */
function run(subject) {
  const file = path.join(tmp, "COMMIT_EDITMSG");
  fs.writeFileSync(file, subject);
  const out = spawnSync(process.execPath, [HOOK, file], { encoding: "utf8" });
  return { ok: out.status === 0, stderr: out.stderr || "" };
}

const RELEASERC = JSON.parse(fs.readFileSync(path.join(REPO, ".releaserc.json"), "utf8"));
const TYPES = RELEASERC.plugins
  .find((p) => Array.isArray(p) && String(p[0]).includes("commit-analyzer"))[1]
  .releaseRules.map((r) => r.type)
  .filter(Boolean);

test("a hook that is not executable is a hook that never runs", () => {
  // Git skips a non-executable hook in silence. Nothing else would catch it.
  const mode = fs.statSync(HOOK).mode;
  assert.ok(mode & 0o111, ".githooks/commit-msg must keep its executable bit");
});

test("every type the release config knows is accepted", () => {
  // The coupling, asserted from the outside: the hook reads .releaserc.json
  // rather than repeating it, so adding a type there cannot leave the gate
  // rejecting commits the release tool would have honoured.
  assert.ok(TYPES.length >= 8, "sanity: the release config should list types");
  for (const type of TYPES) {
    assert.ok(run(`${type}: algo`).ok, `${type} should be accepted`);
  }
});

test("the shapes that already exist in this history all pass", () => {
  // Every one of these is a real subject from the log, or the exact form of
  // one. A gate that rejects the commits already in the repo is a gate that
  // teaches people to edit the check.
  for (const subject of [
    "fix(engines): una respuesta cortada por el tope de salida se nota en ollama y anthropic, no sólo en los demás",
    "feat(web): la carpeta de un proyecto se edita desde Config, y la que no está se marca con un !",
    "feat: algo sin scope",
    "feat(a2a)!: el bang marca el breaking change",
    "chore(release): 1.108.0 [skip ci]",
    "Merge branch 'main' of https://github.com/agentprojectcontext/apx",
    'Revert "fix(web): algo"',
    "fixup! fix(web): algo",
    "squash! fix(web): algo",
  ]) {
    assert.ok(run(subject).ok, `should accept: ${subject}`);
  }

  // Subjects here run long — 117 characters in the last 300 commits — so there
  // is deliberately NO length rule. Adding one would fail real history.
  assert.ok(run(`fix(web): ${"a".repeat(140)}`).ok, "no length limit");
});

test("and the malformed ones do not", () => {
  for (const subject of [
    "update stuff",                    // no type at all
    "feature(web): agrega algo",       // `feature` is not `feat`
    "fix web: algo",                   // scope without parentheses
    "arreglé el bug del chat",         // prose
    "FIX(web): algo",                  // the vocabulary is lowercase
    "fix:",                            // type, no subject
    "wip",
  ]) {
    assert.equal(run(subject).ok, false, `should reject: ${subject}`);
  }
});

test("the rejection says what to do, not just no", () => {
  const { stderr } = run("feature(web): agrega algo");
  assert.match(stderr, /feature/, "it should name the offending word");
  assert.match(stderr, /type\(scope\): subject/, "the shape");
  assert.match(stderr, /rules\/releasing\.md/, "where the contract lives");
  assert.match(stderr, /--no-verify/, "the way out, for when it is wrong");
});

test("a comment-only or empty message is git's business, not ours", () => {
  // git aborts an empty commit message itself; a hook that also errors here
  // just replaces a clear message with a confusing one.
  assert.ok(run("").ok);
  assert.ok(run("\n# Please enter the commit message for your changes.\n").ok);
});

test("the hook is wired up by the same installer as the pre-push gate", () => {
  const installer = fs.readFileSync(path.join(REPO, "scripts/install-githooks.js"), "utf8");
  assert.match(installer, /core\.hooksPath \.githooks/,
    "both hooks live in .githooks/ and are reached the same way");
});
