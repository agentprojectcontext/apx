import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("an engine's list holds its own sessions only, never an agent's chat that runs on its model", async () => {
  const ran = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: ran.id, text: "hello" });
  await env.settle(ran.id);
  const set = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.model", { thread: set.id, model_choice: { model: "claude", router: false } });
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx2-eng-")));
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const session = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "roby",
    project_id: project,
    engine: "claude",
  });

  const ids = async (engine: string) => (await env.client.call("threads.list", { engine })).threads.map((t) => t.id);
  assert.deepEqual(await ids("fake"), [], "the scripted model answered in Roby's chat: still Roby's");
  assert.deepEqual(await ids("claude"), [session.id], "a chat set to Claude Code's model is not a session of it");
  const all = (await env.client.call("threads.list", {})).threads.map((t) => t.id);
  assert.ok(
    [ran.id, set.id].every((id) => all.includes(id)),
    "both stay in the Inbox",
  );
  fs.rmSync(repo, { recursive: true, force: true });
});
