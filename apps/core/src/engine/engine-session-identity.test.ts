import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Harness, TurnIO } from "../harness/index.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

// An engine session is the engine itself, not the agent that opened it (DECISIONS.md#d-274).
const seen: Array<{ models: string[]; system: string; history: TurnIO["history"] }> = [];
const claude: Harness = {
  id: "claude",
  async run(io) {
    seen.push({ models: io.models, system: io.system, history: io.history });
    if (String(io.input.content) === "ask")
      await io.approve({
        callId: `${io.run.id}-x`,
        title: "Edit a file",
        kind: "edit",
        input: { path: `${io.thread.cwd ?? ""}/notes.txt` },
      });
    return { text: "done", model: io.models[0] ?? "claude", sessionId: "s-1" };
  },
};

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("native")), harnesses: { claude } });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("an engine session never runs on, or speaks as, the agent that opened it", async () => {
  const repo = tempDir("apx-engine-identity-").path;
  try {
    const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
    // As an older APX could save it: the agent's own model names this engine.
    const agent = env.core.store.agents.get("superagent");
    assert.ok(agent);
    env.core.store.agents.upsert({ ...agent, model_choice: { model: "claude/agent-own-model", router: false } });
    const thread = await env.client.call("threads.create", {
      kind: "code",
      agent_id: "superagent",
      project_id: project,
      engine: "claude",
    });
    // The owner clears the chat's model: the engine's default answers, not the agent's.
    await env.client.call("threads.model", { thread: thread.id, model_choice: null });
    await env.client.call("threads.send", { thread: thread.id, text: "hello" });
    await env.settle(thread.id);
    const turn = seen.at(-1);
    assert.deepEqual(turn?.models, ["claude"]);
    assert.doesNotMatch(turn?.system ?? "", new RegExp(agent.name));
    // The chat's own pick still wins.
    await env.client.call("threads.model", {
      thread: thread.id,
      model_choice: { model: "claude/picked", router: false },
    });
    await env.client.call("threads.send", { thread: thread.id, text: "again" });
    await env.settle(thread.id);
    assert.deepEqual(seen.at(-1)?.models, ["claude/picked"]);
  } finally {
    const agent = env.core.store.agents.get("superagent");
    if (agent) env.core.store.agents.upsert({ ...agent, model_choice: undefined });
    await removeDir(repo);
  }
});

test("what the owner is asked in an engine session is titled with the engine, not the agent", async () => {
  const repo = tempDir("apx-engine-notice-").path;
  await env.client.call("agents.update", { agent: "superagent", autonomy: "manual" });
  try {
    const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
    const thread = await env.client.call("threads.create", {
      kind: "code",
      agent_id: "superagent",
      project_id: project,
      engine: "claude",
    });
    await env.client.call("threads.send", { thread: thread.id, text: "ask" });
    const card = await waitFor(
      async () => (await env.client.call("runs.pending", { thread: thread.id })).inputs[0],
      "a card",
    );
    const notice = env.core.store.notifications
      .list({ unreadOnly: false, limit: 50 })
      .find((n) => n.kind === "input" && n.thread_id === thread.id);
    assert.equal(notice?.title, "Claude Code");
    await env.client.call("runs.respond", { input: card.id, decision: "deny" });
    await env.settle(thread.id);
  } finally {
    await env.client.call("agents.update", { agent: "superagent", autonomy: null });
    await removeDir(repo);
  }
});
