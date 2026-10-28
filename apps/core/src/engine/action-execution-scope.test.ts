import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

test("a task executor does not block another specialist or a later independent turn", async () => {
  let reviewer = "";
  let resuming = false;
  const llm = scriptedLlm((req, { said, system, afterTool }) => {
    if (system.startsWith("You are Reviewer")) return say("Independent review finished.");
    if (system.startsWith("You are Vera")) {
      const raw = String(req.messages.findLast((m) => m.role === "user")?.content);
      const task = /Task (task_\w+):/.exec(raw)?.[1];
      return task && !afterTool
        ? callTool("close", "task_close", { task, state: "done", note: "Verified the analysis." })
        : say("Analysis delivered.");
    }
    if (resuming)
      return afterTool
        ? say("Kept the existing task executor.")
        : callTool("resumed", "delegate", { agent: "vera", task: "Analyze that report again.", wait_s: 0 });
    if (said === "Later independent question.")
      return afterTool
        ? say("Follow-up received.")
        : callTool("later", "delegate", { agent: "vera", task: "Answer an independent question.", wait_s: 0 });
    if (said !== "Start analysis and independent review.") return say("Results received.");
    const results = req.messages.filter((m) => m.role === "tool");
    if (!afterTool)
      return callTool("start", "task_create", {
        title: "Analyze the report",
        assignee: "vera",
        description: "Analyze the report and deliver findings.",
      });
    if (results.length === 1)
      return callTool("review", "delegate", { agent: reviewer, task: "Review an independent report.", wait_s: 0 });
    return say("Both started.");
  });
  const env = await startCore({ llm });
  try {
    reviewer = (await env.client.call("agents.create", { slug: "reviewer", name: "Reviewer" })).id;
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const sent = await env.client.call("threads.send", {
      thread: chat.id,
      text: "Start analysis and independent review.",
    });
    await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "source completion");
    const sessions = env.core.store.threads.sessions(chat.id);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.agent_ids[0], reviewer);
    await env.settle(chat.id);
    const task = env.core.store.tasks.list({ from_thread: chat.id, limit: 10 })[0];
    assert.ok(task);
    await env.client.call("tasks.update", { task: task.id, assignee: null });
    resuming = true;
    const resumed = env.core.engine.admit({
      thread_id: chat.id,
      agent_id: "roby",
      trigger: "user",
      origin: { kind: "user" },
      text: "Resume the same goal.",
      resume_of: sent.run.id,
    });
    await waitFor(() => Boolean(env.core.store.runs.get(resumed.id)?.ended_at), "resumed turn");
    const blocked = env.core.store.runs.steps(resumed.id).find((s) => s.call_id === "resumed");
    assert.match(blocked?.result ?? "", /already received task/);
    assert.equal(env.core.store.threads.sessions(chat.id).length, 1);
    resuming = false;
    const next = await env.client.call("threads.send", { thread: chat.id, text: "Later independent question." });
    await waitFor(() => Boolean(env.core.store.runs.get(next.run.id)?.ended_at), "independent turn");
    const step = env.core.store.runs.steps(next.run.id).find((s) => s.call_id === "later");
    assert.ok(step);
    assert.doesNotMatch(step.result ?? "", /already received task/);
    assert.ok(env.core.store.threads.sessions(chat.id).some((s) => s.agent_ids[0] === "vera"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
