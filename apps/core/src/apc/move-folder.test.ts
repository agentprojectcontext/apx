import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { manualTimers, tempDir, waitFor } from "../testkit/platform.ts";
import { readProjectFiles } from "./project-reader.ts";

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

const agentsOf = async (client: ApxClient, project: string) =>
  (await client.call("agents.list", {})).agents
    .filter((a) => a.project_id === project)
    .map((a) => a.slug)
    .sort();

/** The tray's notices about moving that project's folder. */
const notices = async (client: ApxClient, project: string) =>
  (await client.call("notifications.list", {})).notifications.filter((n) => n.ref === `agent-folder:${project}`);

test("registering a project that still has .apc/ moves it to .agent/ and tells the owner once", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")), projectWatchTimers: manualTimers() });
  await using dir = tempDir("apx-move-");
  const root = dir.path;
  try {
    project(root, ".agent");
    await env.client.call("projects.register", { path: root });
    assert.deepEqual(await agentsOf(env.client, "p_abc123def456"), ["arch", "ceo"]);
    assert.deepEqual(await notices(env.client, "p_abc123def456"), [], "nothing moved, nothing told");

    // The same folder as an earlier version left it.
    fs.renameSync(path.join(root, ".agent"), path.join(root, ".apc"));
    const r = await env.client.call("projects.register", { path: root });
    assert.equal(r.project.legacy_folder, undefined);
    assert.ok(!fs.existsSync(path.join(root, ".apc")));
    assert.ok(fs.existsSync(path.join(root, ".agent", "agents", "arch.md")));
    assert.deepEqual(await agentsOf(env.client, "p_abc123def456"), ["arch", "ceo"], "the same agents, none archived");
    const told = await notices(env.client, "p_abc123def456");
    assert.equal(told.length, 1);
    assert.equal(told[0]?.level, "info");
    assert.match(told[0]?.title ?? "", /\.agent\//);

    await env.client.call("projects.register", { path: root });
    assert.equal((await notices(env.client, "p_abc123def456")).length, 1, "a second register has nothing to tell");
  } finally {
    await env.core.close();
  }
});

test("at start, every project that still has .apc/ is moved and told", async () => {
  await using dir = tempDir("apx-move-start-");
  const root = dir.path;
  project(root, ".agent");
  const first = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    await first.client.call("projects.register", { path: root });
  } finally {
    await first.core.close();
  }
  fs.renameSync(path.join(root, ".agent"), path.join(root, ".apc"));
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    home: first.home,
    projectRead: async (folder) => readProjectFiles(folder),
  });
  try {
    await waitFor(
      async () => (await notices(env.client, "p_abc123def456")).length === 1,
      "the move at start to be told",
    );
    assert.ok(!fs.existsSync(path.join(root, ".apc")));
    assert.deepEqual(await agentsOf(env.client, "p_abc123def456"), ["arch", "ceo"]);
  } finally {
    await env.core.close();
    await first.cleanup();
  }
});

test("a project whose .apc/ cannot be moved keeps working from it, says why, and moves on a retry", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")), projectWatchTimers: manualTimers() });
  await using dir = tempDir("apx-move-fail-");
  const root = dir.path;
  try {
    project(root, ".apc");
    write(path.join(root, ".agent"), "a file, not a folder");
    const r = await env.client.call("projects.register", { path: root });
    assert.equal(r.project.legacy_folder, true);
    assert.equal(r.project.name, "Northwind", "read from .apc/");
    assert.deepEqual(await agentsOf(env.client, r.project.id), ["arch", "ceo"]);
    const [failed] = await notices(env.client, r.project.id);
    assert.equal(failed?.level, "warn");
    assert.match(failed?.body ?? "", /a file named \.agent is in the way/);

    // Its settings still save, where its files are.
    await env.client.call("projects.update", { project: r.project.id, name: "Northwind Labs" });
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".apc", "project.json"), "utf8")).name, "Northwind Labs");

    fs.rmSync(path.join(root, ".agent"));
    const moved = await env.client.call("projects.move_folder", { project: r.project.id });
    assert.deepEqual([moved.files, moved.done, moved.agents], [3, true, 2]);
    assert.equal(moved.project.legacy_folder, undefined);
    const told = await notices(env.client, r.project.id);
    assert.deepEqual(
      told.map((n) => n.level),
      ["info"],
      "the warning is replaced by the move",
    );
  } finally {
    await env.core.close();
  }
});
