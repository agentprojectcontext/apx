// A code session's file and shell tools must resolve against the session's
// project — or the folder it was opened from. The route handed runSuperAgent the
// unscoped registry, so `read_file {path:"math.js"}` read ~/.apx/projects/default
// and answered "file not found" for a file `glob` had just listed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scopeProjectsToWorkdir, resolveProject } from "#core/apc/projects-helpers.js";
import readFile from "#core/agent/tools/handlers/read-file.js";

function registry(rows) {
  return {
    get: (id) => rows.find((r) => String(r.id) === String(id)) || null,
    list: () => rows,
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-code-scope-"));
const home = path.join(tmp, "default");
const acme = path.join(tmp, "acme");
const loose = path.join(tmp, "loose");
for (const d of [home, acme, path.join(acme, "src"), loose]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(acme, "src", "math.js"), "export const one = 1;\n");
fs.writeFileSync(path.join(loose, "math.js"), "export const two = 2;\n");
const projects = registry([{ id: 0, name: "default", path: home }, { id: 1, name: "acme", path: acme }]);

test("an unqualified path in a project's session resolves inside that project", () => {
  const scoped = scopeProjectsToWorkdir(projects, 1, path.join(acme, "src"));
  assert.equal(resolveProject(scoped).path, acme, "a cwd inside keeps the project root");
  const read = readFile.makeHandler({ projects: scoped });
  assert.match(read({ path: "src/math.js" }).content, /one = 1/);
});

test("a session opened from an unregistered folder works in that folder", () => {
  const scoped = scopeProjectsToWorkdir(projects, 0, loose);
  const read = readFile.makeHandler({ projects: scoped });
  assert.match(read({ path: "math.js" }).content, /two = 2/);
  // The model names the session's project as often as not.
  assert.match(read({ project: "default", path: "math.js" }).content, /two = 2/);
  assert.match(read({ project: "0", path: "math.js" }).content, /two = 2/);
  // Another project is still reachable by name, at its own root.
  assert.equal(resolveProject(scoped, "1").path, acme);
});

test("no cwd, or a relative one, leaves the plain project scope", () => {
  assert.equal(resolveProject(scopeProjectsToWorkdir(projects, 1)).path, acme);
  assert.equal(resolveProject(scopeProjectsToWorkdir(projects, 1, "src")).path, acme);
});

test("the code-session route hands the turn a scoped registry", () => {
  // The route is the one caller that forgot; a full turn needs a daemon, so the
  // wiring is pinned at its source.
  const src = fs.readFileSync(new URL("../src/host/daemon/api/code.js", import.meta.url), "utf8");
  assert.match(src, /const sessionProjects = scopeProjectsToWorkdir\(projects,\s*p\.id,\s*cwd\)/);
  const call = src.slice(src.indexOf("await runSuperAgent({"), src.indexOf("await runSuperAgent({") + 300);
  assert.match(call, /projects:\s*sessionProjects/);
});
