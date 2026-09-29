// The private-terms guard (scripts/check-private-terms.js).
//
// The denylist is local and untracked on purpose, so everything here runs
// against a SYNTHETIC list in a temp dir — never the owner's real one. APX_HOME
// is pinned to the temp dir before the import, so the default ~/.apx lookup
// can never reach the developer's real home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "apx-private-terms-"));
process.env.APX_HOME = path.join(TMP, ".apx");
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { parseTerms, findPrivateTerms, loadTerms, termFiles, fold } = await import("../scripts/check-private-terms.js");

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/check-private-terms.js");

function tree(files) {
  const root = fs.mkdtempSync(path.join(TMP, "tree-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return { root, files: Object.keys(files) };
}

function scan(list, files) {
  const { matchers, allow } = parseTerms(list);
  const t = tree(files);
  return findPrivateTerms({ root: t.root, files: t.files, matchers, allow });
}

test("a term matches case- and accent-insensitively, as a whole word", () => {
  const hits = scan("Zorbéx\n", {
    "a.js": "// asked by ZORBEX yesterday\n",
    "b.md": "zorbex_task_update and zorbex-agent\n",
    "c.js": "const zorbexine = 1; // part of a longer word\n",
    "d.txt": "clean\n",
  });
  assert.deepEqual(hits.map((h) => `${h.file}:${h.line}`), ["a.js:1", "b.md:1"]);
  assert.equal(fold("Zorbéx"), "zorbex");
});

test("re: lines match raw regexes and allow: masks a functional reference", () => {
  const hits = scan("re:5490000\\d{6}\nqorvan\nallow:github.com/qorvan-labs/\n", {
    "a.js": 'const jid = "5490000123456@s.whatsapp.net";\n',
    "b.js": 'const url = "https://github.com/qorvan-labs/tool";\n',
    "c.js": "// qorvan said so\n",
  });
  assert.deepEqual(hits.map((h) => `${h.file}:${h.term}`), ["a.js:re:5490000\\d{6}", "c.js:qorvan"]);
});

test("comments, blank lines and a bad regex never throw", () => {
  const { matchers, errors } = parseTerms("# a comment\n\nre:(unclosed\nfine\n");
  assert.equal(matchers.length, 1);
  assert.equal(errors.length, 1);
});

test("binary files are skipped", () => {
  const hits = scan("qorvan\n", { "bin.dat": Buffer.concat([Buffer.from("qorvan"), Buffer.from([0, 1, 2])]) });
  assert.deepEqual(hits, []);
});

test("the list is read from APX_HOME, or only from APX_PRIVATE_TERMS when that is set", () => {
  const repo = fs.mkdtempSync(path.join(TMP, "repo-"));
  assert.deepEqual(termFiles({ APX_HOME: process.env.APX_HOME }, repo), []);

  fs.writeFileSync(path.join(process.env.APX_HOME, "private-terms.txt"), "qorvan\n");
  fs.mkdirSync(path.join(repo, "spec"));
  fs.writeFileSync(path.join(repo, "spec", "private-terms.txt"), "zorbex\n");
  const both = loadTerms({ APX_HOME: process.env.APX_HOME }, repo);
  assert.equal(both.files.length, 2);
  assert.deepEqual(both.matchers.map((m) => m.label).sort(), ["qorvan", "zorbex"]);

  const only = path.join(TMP, "only.txt");
  fs.writeFileSync(only, "vantrel\n");
  assert.deepEqual(termFiles({ APX_HOME: process.env.APX_HOME, APX_PRIVATE_TERMS: only }, repo), [only]);
  assert.deepEqual(termFiles({ APX_PRIVATE_TERMS: path.join(TMP, "missing.txt") }, repo), []);
  fs.rmSync(path.join(process.env.APX_HOME, "private-terms.txt"));
});

test("with no list the script passes silently — CI has none, by design", () => {
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, APX_PRIVATE_TERMS: path.join(TMP, "does-not-exist.txt") },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "");
  assert.equal(res.stderr, "");
});

test("the list itself is never tracked: spec/ is gitignored", () => {
  const gitignore = fs.readFileSync(path.resolve(path.dirname(SCRIPT), "..", ".gitignore"), "utf8");
  assert.match(gitignore, /^\/spec\/$/m);
});
