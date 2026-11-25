import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { manualTimers, tempDir } from "../testkit/platform.ts";

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

function project(root: string, dir: string) {
  write(path.join(root, "AGENTS.md"), "# Northwind\n");
  write(path.join(root, dir, "project.json"), JSON.stringify({ name: "Northwind", apx_id: "abc123def456" }));
  write(path.join(root, dir, "agents", "arch.md"), "---\nname: Arch\nrole: Architect\n---\n\nKeep it simple.\n");
  write(path.join(root, dir, "agents", "ceo.md"), "---\nname: Ceo\nrole: Chief Executive\n---\n\nDecide.\n");
}

test("a project whose files are still in .apc/ keeps its agents until the owner moves them to .agent/", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")), projectWatchTimers: manualTimers() });
  await using dir = tempDir("apx-move-");
  const root = dir.path;
  const agents = async () =>
    (await env.client.call("agents.list", {})).agents
      .filter((a) => a.project_id === "p_abc123def456")
      .map((a) => a.slug)
      .sort();
  const listed = async () =>
    (await env.client.call("projects.list", {})).projects.find((p) => p.id === "p_abc123def456");
  try {
    project(root, ".agent");
    await env.client.call("projects.register", { path: root });
    assert.deepEqual(await agents(), ["arch", "ceo"]);

    // An install that still has .apc/ (as before this version): nothing is archived, the move is offered.
    fs.renameSync(path.join(root, ".agent"), path.join(root, ".apc"));
    await env.client.call("projects.sync", { project: "p_abc123def456" });
    assert.deepEqual(await agents(), ["arch", "ceo"]);
    assert.equal((await listed())?.legacy_folder, true);

    // Writing the project's files would start .agent/ beside them and hide them: refused until they move.
    await assert.rejects(
      env.client.call("projects.update", { project: "p_abc123def456", name: "Northwind Labs" }),
      (err: unknown) => err instanceof ApxError && /still in \.apc\//.test(err.message),
    );
    assert.ok(!fs.existsSync(path.join(root, ".agent")));

    const moved = await env.client.call("projects.move_folder", { project: "p_abc123def456" });
    assert.deepEqual([moved.files, moved.done, moved.agents, moved.conflicts], [3, true, 2, []]);
    assert.equal(moved.project.legacy_folder, undefined);
    assert.ok(!fs.existsSync(path.join(root, ".apc")));
    assert.ok(fs.existsSync(path.join(root, ".agent", "agents", "arch.md")));
    assert.deepEqual(await agents(), ["arch", "ceo"]);

    // Again: nothing to do, nothing changes.
    const again = await env.client.call("projects.move_folder", { project: "p_abc123def456" });
    assert.deepEqual([again.files, again.done, again.agents], [0, true, 2]);
    await env.client.call("projects.update", { project: "p_abc123def456", name: "Northwind Labs" });
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".agent", "project.json"), "utf8")).name, "Northwind Labs");
  } finally {
    await env.core.close();
  }
});

test("a folder registered with its files only in .apc/ is added, offered the move, and read once moved", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")), projectWatchTimers: manualTimers() });
  await using dir = tempDir("apx-move-new-");
  const root = dir.path;
  try {
    project(root, ".apc");
    const r = await env.client.call("projects.register", { path: root, init: true });
    assert.equal(r.project.legacy_folder, true);
    assert.equal(r.agents, 0);
    assert.ok(!fs.existsSync(path.join(root, ".agent")), "init does not start an empty .agent/ beside .apc/");

    const moved = await env.client.call("projects.move_folder", { project: r.project.id });
    assert.equal(moved.agents, 2);
    assert.equal(moved.project.name, "Northwind");
    assert.equal(moved.project.legacy_folder, undefined);
  } finally {
    await env.core.close();
  }
});
