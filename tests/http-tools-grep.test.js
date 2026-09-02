// The grep tool, run against BOTH of its backends.
//
// That is the point of this file. `grepFiles` tries ripgrep and falls back to a
// Node walk, so which code path runs is decided by whether the machine happens
// to have `rg` installed — and the two disagreed. A dev machine with
// `brew install ripgrep` never reached the fallback; the CI runner never reached
// anything else. So a grep of a single file returned no matches for three days
// on every install without ripgrep, the local gate stayed green, and CI went red
// on a test nobody could reproduce.
//
// Every case below therefore runs twice: once with the PATH as it is, once with
// `rg` unreachable. Whichever machine runs this, the fallback is exercised.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-grep-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { grepFiles } = await import("../src/core/http-tools/grep.js");

const root = path.join(tmpHome, "notes");
fs.mkdirSync(path.join(root, "sub"), { recursive: true });
fs.writeFileSync(path.join(root, "brain.md"), "backlog lleno 10/10\nnada\nbacklog otra vez\n");
fs.writeFileSync(path.join(root, "sub", "diario.md"), "backlog tres\nbacklog cuatro\n");
fs.writeFileSync(path.join(root, "sub", "quieto.md"), "sin nada que ver\n");

test.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

/**
 * Run `body` twice: once as the machine is, once with `rg` unreachable.
 *
 * PATH is read by execFile at spawn time, so emptying it is enough to make the
 * ripgrep branch throw ENOENT and hand over to the Node walk — the real
 * dispatcher, the real fallback, no seam added to production code for the test.
 */
function onBothBackends(name, body) {
  test(`${name} [ripgrep, or node when rg is absent]`, () => body());
  test(`${name} [node fallback]`, async () => {
    const realPath = process.env.PATH;
    process.env.PATH = path.join(tmpHome, "no-such-bin");
    try {
      await body("node");
    } finally {
      process.env.PATH = realPath;
    }
  });
}

onBothBackends("a grep of ONE file finds what is in it", async (expected) => {
  // The regression: walkFiles() began with readdirSync on the search path, which
  // throws ENOTDIR for a file. The throw was swallowed, so the answer was not an
  // error but an empty result — the worst shape a wrong answer can take, because
  // the caller reads it as "the word is not there".
  const r = await grepFiles({ pattern: "backlog", path: "brain.md", cwd: root });
  if (expected) assert.equal(r.backend, expected, "the fallback must be what ran");
  assert.equal(r.total_matches, 2);
  assert.equal(r.files_with_matches, 1);
  assert.equal(r.matches[0].file, "brain.md", "a file searched by name is called by its name");
  assert.equal(r.matches[0].absolute, path.join(root, "brain.md"));
  assert.deepEqual(r.matches[0].matches.map((m) => m.line), [1, 3]);
});

onBothBackends("a directory groups its hits by file, one entry each", async (expected) => {
  // `files_with_matches` was a second copy of `total_matches`: the rg branch
  // grouped on `last.file` (the relative label) while comparing it to the
  // absolute path, so four hits in two files were reported as four files.
  const r = await grepFiles({ pattern: "backlog", path: ".", cwd: root });
  if (expected) assert.equal(r.backend, expected);
  assert.equal(r.total_matches, 4);
  assert.equal(r.files_with_matches, 2, "two files, however many hits are in them");
  assert.deepEqual(
    r.matches.map((m) => [m.file, m.matches.length]).sort(),
    [["brain.md", 2], [path.join("sub", "diario.md"), 2]],
  );
});

onBothBackends("a relative path resolves against the cwd it was given", async (expected) => {
  // An agent scoped to a project searches paths relative to THAT project, from a
  // daemon standing somewhere else entirely.
  const r = await grepFiles({ pattern: "cuatro", path: "sub/diario.md", cwd: root });
  if (expected) assert.equal(r.backend, expected);
  assert.equal(r.total_matches, 1);
  assert.equal(r.matches[0].file, "diario.md");
});

onBothBackends("a path that is not there is an error, not an empty answer", async () => {
  await assert.rejects(
    () => grepFiles({ pattern: "backlog", path: "no/such/file.md", cwd: root }),
    /path does not exist/,
    "the one case that SHOULD come back empty-handed says so out loud",
  );
});

onBothBackends("a file with no hit is empty without being an error", async (expected) => {
  const r = await grepFiles({ pattern: "backlog", path: "sub/quieto.md", cwd: root });
  if (expected) assert.equal(r.backend, expected);
  assert.equal(r.total_matches, 0);
  assert.deepEqual(r.matches, []);
});

onBothBackends("case-insensitive by default, exact when asked", async () => {
  assert.equal((await grepFiles({ pattern: "BACKLOG", path: "brain.md", cwd: root })).total_matches, 2);
  assert.equal(
    (await grepFiles({ pattern: "BACKLOG", path: "brain.md", cwd: root, case_sensitive: true })).total_matches,
    0,
  );
});
