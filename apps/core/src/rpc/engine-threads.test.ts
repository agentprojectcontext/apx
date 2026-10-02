import assert from "node:assert/strict";
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

test("an engine's chats: those it answered in and those set to it before it did", async () => {
  const ran = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: ran.id, text: "hello" });
  await env.settle(ran.id);
  const set = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.model", { thread: set.id, model_choice: { model: "claude", router: false } });
  const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });

  const ids = async (engine: string) => (await env.client.call("threads.list", { engine })).threads.map((t) => t.id);
  assert.deepEqual(await ids("fake"), [ran.id], "the scripted model answered there");
  assert.deepEqual(await ids("claude"), [set.id], "set to Claude Code, not run yet");
  assert.ok(!(await ids("codex")).includes(other.id));
  assert.ok((await env.client.call("threads.list", {})).threads.some((t) => t.id === other.id));
});
