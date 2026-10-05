import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

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
    env.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
