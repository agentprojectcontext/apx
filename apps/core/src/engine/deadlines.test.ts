import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { CODE_DEADLINE_MS, RUN_DEADLINE_MS } from "./engine.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const deadlineOf = async (thread: string) => {
  await env.client.call("threads.send", { thread, text: "hola" });
  const run = env.core.store.runs.list(thread, 1)[0];
  return Date.parse(run?.deadline_at ?? "") - Date.parse(run?.started_at ?? "");
};

test("a coding session with an outside engine gets an hour; a chat turn keeps its minutes", async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-deadline-")));
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const code = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "roby",
    project_id: project,
    engine: "claude",
  });
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  const long = await deadlineOf(code.id);
  const short = await deadlineOf(chat.id);
  assert.ok(Math.abs(long - CODE_DEADLINE_MS) < 5000, `code session: ${long}`);
  assert.ok(Math.abs(short - RUN_DEADLINE_MS) < 5000, `chat turn: ${short}`);
});
