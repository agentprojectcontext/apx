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

const { parseTerms, findPrivateTerms, findRealShapes, loadTerms, termFiles, fold } = await import("../scripts/check-private-terms.js");

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

test("with no list the script still runs the public shapes — and the repo passes them", () => {
  // No private list, as in CI. The built-in shapes still scan every tracked
  // file of THIS repo, so this test is also the tip check.
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, APX_PRIVATE_TERMS: path.join(TMP, "does-not-exist.txt") },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /ok \(shapes; no local list\)/);
  assert.equal(res.stderr, "");
});

// Real-looking values are ASSEMBLED at run time: a literal here would be a
// real-shaped number sitting in a tracked file, which is what the check forbids.
// The area code starts with 0, which no Argentine number does.
const REALISH_PHONE = ["549", "0718", "293645"].join("");
const REALISH_LID = ["8071", "6253", "4918", "273"].join("");
const REALISH_TYPED = ["+54 9 07", "1829-3645"].join(" ");
const REALISH_USER = ["", "Users", "jdoe-real", ".apx"].join("/");
const REALISH_DISK = ["", "Volumes", "MyDisk", "projects"].join("/");

function shapes(files) {
  const t = tree(files);
  return findRealShapes({ root: t.root, files: t.files }).map((h) => `${h.file}:${h.line}:${h.term}`);
}

test("a real-looking WhatsApp number or LID is caught with no list at all", () => {
  assert.deepEqual(
    shapes({
      "a.js": `const jid = "${REALISH_PHONE}@s.whatsapp.net";\n`,
      "b.md": `alias \`${REALISH_LID}@lid\`\n`,
      "c.js": `// the owner wrote from ${REALISH_PHONE} yesterday\n`,
      "d.md": `call ${REALISH_TYPED} tomorrow\n`,
    }),
    ["a.js:1:whatsapp-number", "b.md:1:whatsapp-number", "c.js:1:whatsapp-number", "d.md:1:whatsapp-number"],
  );
});

test("invented numbers and WhatsApp's public service accounts pass", () => {
  assert.deepEqual(
    shapes({
      "a.js": [
        '"5491155550000@s.whatsapp.net"', // four identical digits
        '"100000000000100@lid"',
        '"5491122334455"', // doubled pairs
        '"1234567890@s.whatsapp.net"', // a counting run
        '"16505361212@s.whatsapp.net"', // WhatsApp's own service number
        '"+54 9 11 5555-5555"',
      ].join("\n"),
    }),
    [],
  );
});

test("an absolute macOS path must name a placeholder user or disk", () => {
  assert.deepEqual(
    shapes({
      "a.js": `const p = '${REALISH_USER}';\n`,
      "b.md": `cwd: ${REALISH_DISK}\n`,
      "c.js": [
        "'/Users/you/project'",
        "'/Volumes/work/repo'",
        "saved to /Users/…]",
        "'/path/to/project'",
        "https://example.com/Users/jdoe", // a URL segment, not a local path
      ].join("\n"),
    }),
    ["a.js:1:user-path", "b.md:1:user-path"],
  );
});

test("the list itself is never tracked: spec/ is gitignored", () => {
  const gitignore = fs.readFileSync(path.resolve(path.dirname(SCRIPT), "..", ".gitignore"), "utf8");
  assert.match(gitignore, /^\/spec\/$/m);
});
