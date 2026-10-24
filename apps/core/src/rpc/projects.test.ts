import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

test("unregister keeps files and history, stops queued watchers, and registering restores the same project", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-project-remove-"));
  try {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Acme\n");
    const { project } = await env.client.call("projects.register", { path: root });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project.id });
    await env.client.call("threads.send", { thread: thread.id, text: "Keep this history" });
    await env.settle(thread.id);
    const before = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
    // Queue a reindex just before unregistering; it must not put the folder back.
    fs.writeFileSync(path.join(root, "AGENTS.md"), `${before}Keep metric units.\n`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const saved = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
    await env.client.call("projects.unregister", { project: project.id });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(!(await env.client.call("projects.list", {})).projects.some((p) => p.id === project.id));
    assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), saved);
    assert.equal((await env.client.call("threads.get", { thread: thread.id })).thread.project_id, project.id);
    assert.equal((await env.client.call("threads.get", { thread: thread.id })).messages.length, 2);
    const history = (await env.client.call("projects.list", { include_unregistered: true })).projects.find(
      (p) => p.id === project.id,
    );
    assert.equal(history?.registered, false);
    assert.equal(history?.name, project.name);
    await env.client.call("projects.sync", {});
    assert.ok(!(await env.client.call("projects.list", {})).projects.some((p) => p.id === project.id));
    const restored = await env.client.call("projects.register", { path: root });
    assert.equal(restored.project.id, project.id);
    assert.ok((await env.client.call("projects.list", {})).projects.some((p) => p.id === project.id));
    await assert.rejects(env.client.call("projects.unregister", { project: "~default" }));
  } finally {
    await env.core.close();
    await env.cleanup();
    await removeDir(root);
  }
});

test("a project is created with a name and kind: without a folder in APX's home, or in a folder, named or not", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const outside = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-project-create-")));
  try {
    const a = await env.client.call("projects.create", { name: "Ventas Q4 · Acme", kind: "company" });
    assert.equal(a.project.name, "Ventas Q4 · Acme");
    assert.equal(a.project.kind, "company");
    assert.equal(realpath(a.project.path ?? ""), path.join(realpath(env.home), "projects", "ventas-q4-acme"));
    assert.match(fs.readFileSync(path.join(a.project.path ?? "", "AGENTS.md"), "utf8"), /^# Ventas Q4 · Acme/);
    // The same name again gets a folder of its own.
    const b = await env.client.call("projects.create", { name: "Ventas Q4 · Acme" });
    assert.equal(path.basename(b.project.path ?? ""), "ventas-q4-acme-2");

    // A folder that does not exist yet is made; with no name, the project takes the folder's.
    const c = await env.client.call("projects.create", { path: path.join(outside, "northwind") });
    assert.equal(c.project.name, "northwind");
    const d = await env.client.call("projects.create", {
      path: path.join(outside, "globex"),
      name: "Globex shop",
      kind: "app",
      description: "The online store.",
    });
    assert.equal(d.project.name, "Globex shop");
    assert.equal(d.project.description, "The online store.");
    await assert.rejects(env.client.call("projects.create", {}), /invalid params/);
    await assert.rejects(env.client.call("projects.create", { path: "work/relative" }), /not a full path/);
  } finally {
    await env.core.close();
    await env.cleanup();
    await removeDir(outside);
  }
});

test("register with init writes only what is missing, never over a file, and again is the same project", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const outside = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-project-init-")));
  try {
    const plain = path.join(outside, "northwind");
    fs.mkdirSync(plain);
    const a = await env.client.call("projects.register", { path: plain, init: true });
    assert.equal(fs.readFileSync(path.join(plain, "AGENTS.md"), "utf8"), "# northwind\n");
    assert.ok(fs.statSync(path.join(plain, ".apc")).isDirectory());
    fs.writeFileSync(path.join(plain, ".apc", "project.json"), '{"name":"Northwind"}');
    const again = await env.client.call("projects.register", { path: plain, init: true });
    assert.equal(again.project.id, a.project.id);
    assert.equal(again.project.name, "Northwind");
    assert.equal(fs.readFileSync(path.join(plain, ".apc", "project.json"), "utf8"), '{"name":"Northwind"}');

    const documented = path.join(outside, "acme");
    fs.mkdirSync(documented);
    fs.writeFileSync(path.join(documented, "AGENTS.md"), "# Acme\n\nUse metric units.\n");
    await env.client.call("projects.register", { path: documented, init: true });
    assert.equal(fs.readFileSync(path.join(documented, "AGENTS.md"), "utf8"), "# Acme\n\nUse metric units.\n");
    assert.ok(fs.existsSync(path.join(documented, ".apc")));

    await assert.rejects(
      env.client.call("projects.register", { path: path.join(outside, "missing"), init: true }),
      /not a folder/,
    );
    assert.ok(!fs.existsSync(path.join(outside, "missing")));
  } finally {
    await env.core.close();
    await env.cleanup();
    await removeDir(outside);
  }
});

test("clients hear once when a project or an agent changes, and nothing from a reindex that changed nothing", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const heard: string[] = [];
  env.core.bus.on((e) => void (e.type === "team.updated" && heard.push(e.type)));
  const tick = () => new Promise((r) => setTimeout(r, 10));
  try {
    const { project } = await env.client.call("projects.create", { name: "Northwind" });
    await tick();
    assert.equal(heard.length, 1, "a new project, indexed in one burst");

    await env.client.call("agents.create", {
      project_id: project.id,
      slug: "scout",
      name: "Scout",
      role: "",
      prompt: "",
    });
    await new Promise((r) => setTimeout(r, 600)); // the agent's file wakes the watcher too
    assert.ok(heard.length >= 2, "a new agent");

    heard.length = 0;
    await env.client.call("projects.sync", { project: project.id });
    await tick();
    assert.equal(heard.length, 0, "the files are as they were");

    await env.client.call("projects.update", { project: project.id, description: "Wholesale client" });
    await tick();
    assert.equal(heard.length, 1, "a description");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
