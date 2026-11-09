import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";
import { agentProject } from "./agent-project.ts";

test("a channel's chats take the project of the agent that answers them; the super-agent has none", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const dir = tempDir("apx-head-");
  try {
    fs.writeFileSync(path.join(dir.path, "AGENTS.md"), "# Acme\n");
    const { project } = await env.client.call("projects.register", { path: dir.path, init: true });
    const head = await env.client.call("agents.create", { project_id: project.id, slug: "acme-head", name: "Head" });
    assert.equal(agentProject(env.core.store, head.id), project.id);
    assert.equal(agentProject(env.core.store, "superagent"), undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
    await dir.remove();
  }
});
