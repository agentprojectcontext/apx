import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("an engine's list holds its own sessions only, and a CLI runs nowhere else", async () => {
  const ran = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: ran.id, text: "hello" });
  await env.settle(ran.id);
  // Outside its own sessions a CLI is no chat's model.
  await assert.rejects(
    env.client.call("threads.model", { thread: ran.id, model_choice: { model: "claude", router: false } }),
    /own sessions/,
  );
  const repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-eng-")));
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const session = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "roby",
    project_id: project,
    engine: "claude",
  });

  const ids = async (engine: string) => (await env.client.call("threads.list", { engine })).threads.map((t) => t.id);
  assert.deepEqual(await ids("fake"), [], "the scripted model answered in Roby's chat: still Roby's");
  assert.deepEqual(await ids("claude"), [session.id]);
  const all = (await env.client.call("threads.list", {})).threads.map((t) => t.id);
  assert.ok(all.includes(ran.id), "Roby's chat stays in the Inbox");
  await removeDir(repo);
});
