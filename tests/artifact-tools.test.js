// An agent can write a runnable file now. Two things had to be true first, and
// both were false: the name had to stop being a path (`path.join` let
// `../../evil` out of the directory, which was survivable while only a person
// could reach it) and "create" had to be able to replace, or regenerating a
// script would be a delete-then-create dance that leaves nothing behind when it
// fails halfway.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-arttools-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { createArtifact, artifactPath, listArtifacts, readArtifact, assertArtifactName } =
  await import("#core/stores/artifacts.js");
const writeArtifact = (await import("#core/agent/tools/handlers/write-artifact.js")).default;
const listArtifactsTool = (await import("#core/agent/tools/handlers/list-artifacts.js")).default;
const { defaultAgentToolNames } = await import("#core/agent/agent-tools.js");

const store = () => fs.mkdtempSync(path.join(os.tmpdir(), "apx-store-"));

// A project record shaped like the one the tools receive.
function projects(storagePath) {
  const p = { id: 1, name: "Acme", path: storagePath, storagePath };
  return { list: () => [p], get: () => p, current: () => p };
}
const allow = async () => true;

test("a name is a name, never a path", () => {
  const s = store();
  for (const bad of ["../../evil", "a/b", ".hidden", "..", ""]) {
    assert.throws(() => artifactPath(s, bad), /invalid artifact name|name required/, `accepted "${bad}"`);
  }
  assert.equal(path.basename(artifactPath(s, "source-board.sh")), "source-board.sh");
  assert.equal(assertArtifactName("  ok.mjs  "), "ok.mjs");
});

test("create refuses to clobber, unless you say so", () => {
  const s = store();
  createArtifact(s, "a.sh", "one");
  assert.throws(() => createArtifact(s, "a.sh", "two"), /already exists/);
  createArtifact(s, "a.sh", "two", { overwrite: true });
  assert.equal(readArtifact(s, "a.sh").content, "two");
});

test("a script with a shebang comes out runnable", () => {
  const s = store();
  const p = createArtifact(s, "run.sh", "#!/bin/sh\necho hi\n");
  assert.ok(fs.statSync(p).mode & 0o111, "a shebang without the exec bit fails at spawn with a confusing error");
  const plain = createArtifact(s, "data.json", "{}");
  assert.equal(Boolean(fs.statSync(plain).mode & 0o111), false);
});

test("the agent tool writes into the project's STORAGE and says how to wire it", async () => {
  const s = store();
  const handler = writeArtifact.makeHandler({ projects: projects(s), requirePermission: allow });
  const out = await handler({ name: "source-board.mjs", content: "#!/usr/bin/env node\nconsole.log('<board/>')" });

  assert.equal(out.ok, true);
  assert.equal(out.reference, "artifact:source-board.mjs", "the next question is always how a routine calls it");
  assert.equal(out.replaced, false);
  assert.equal(path.dirname(out.path), path.join(s, "artifacts"));
  assert.deepEqual(listArtifacts(s).map((a) => a.name), ["source-board.mjs"]);
});

test("writing over an existing one reports that it replaced something", async () => {
  const s = store();
  const handler = writeArtifact.makeHandler({ projects: projects(s), requirePermission: allow });
  await handler({ name: "a.sh", content: "one" });
  await assert.rejects(handler({ name: "a.sh", content: "two" }), /already exists/);
  const out = await handler({ name: "a.sh", content: "two", overwrite: true });
  assert.equal(out.replaced, true);
});

test("the write asks for permission — it is not a read", async () => {
  const s = store();
  let asked = null;
  const handler = writeArtifact.makeHandler({
    projects: projects(s),
    requirePermission: async (name, opts) => { asked = { name, ...opts }; return true; },
  });
  await handler({ name: "x.sh", content: "y" });
  assert.equal(asked.name, "write_artifact");
  assert.equal(asked.dangerous, true);
});

test("listing reads one back so an agent can look before it replaces", async () => {
  const s = store();
  createArtifact(s, "a.sh", "body");
  const handler = listArtifactsTool.makeHandler({ projects: projects(s) });
  assert.deepEqual((await handler({})).map((a) => a.name), ["a.sh"]);
  assert.equal((await handler({ name: "a.sh" })).content, "body");
});

test("both tools are actually reachable by an agent", () => {
  const names = defaultAgentToolNames();
  assert.ok(names.includes("write_artifact"), "registered in names.js but not in the registry is a silent no-op");
  assert.ok(names.includes("list_artifacts"));
});
