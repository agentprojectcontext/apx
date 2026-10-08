import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { harnessDir, workDir } from "./shell.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let repo: string;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-folders-")));
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

const dirs = (thread: { cwd?: string; project_id?: string }) => [
  workDir(env.core.store, env.home, thread),
  harnessDir(env.core.store, env.home, thread),
];

test("an agent works in its project's folder; an outside agent in APX's side of it, never among other projects", async () => {
  const work = path.join(env.home, "work");
  assert.deepEqual(dirs({}), [work, work]);

  const inRepo = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const side = path.join(env.home, "projects", inRepo);
  assert.deepEqual(dirs({ project_id: inRepo }), [repo, side]);
  assert.deepEqual(dirs({ project_id: inRepo, cwd: repo }), [repo, repo]);

  // A project APX made with no folder elsewhere already is APX's own: both work in it.
  const made = (await env.client.call("projects.create", { name: "Northwind" })).project;
  const own = path.join(env.home, "projects", "northwind");
  assert.deepEqual(dirs({ project_id: made.id }), [own, own]);

  // Its folder off this machine, a project's chat keeps to the project's side, not the folder every chat shares.
  env.core.store.projects.setPresent(inRepo, false);
  assert.deepEqual(dirs({ project_id: inRepo }), [side, side]);
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: inRepo });
  await env.client.call("files.tree", { thread: t.id, dir: "" });
  assert.ok(fs.statSync(side).isDirectory(), "opened in the panel, APX's side is made");
});
