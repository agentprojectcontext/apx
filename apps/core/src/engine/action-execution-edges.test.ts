import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const capture of ["proposal", "future", "unspecified"] as const) {
  test(`${capture} does not claim a task execution channel`, async () => {
    const llm = scriptedLlm((req, { afterTool, system, said }) => {
      if (system.startsWith("You are Vera")) return say("Independent findings.");
      if (!said.includes("Keep this for later and ask now.")) return say("Review received.");
      const results = req.messages.filter((m) => m.role === "tool");
      if (!afterTool)
        return callTool("capture", "task_create", {
          title: "Review the report",
          assignee: "vera",
          ...(capture !== "unspecified" ? { description: "Review the report." } : {}),
          ...(capture === "proposal" ? { propose: true } : {}),
          ...(capture === "future" ? { start_at: "2099-01-01T00:00:00Z" } : {}),
        });
      if (results.length === 1)
        return callTool("ask", "delegate", { agent: "vera", task: "Independent current review.", wait_s: 0 });
      return say("Recorded and asked.");
    });
    const env = await startCore({ llm });
    try {
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      const sent = await env.client.call("threads.send", { thread: chat.id, text: "Keep this for later and ask now." });
      await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "source completion");
      assert.equal(env.core.store.threads.sessions(chat.id).length, 1);
      const tasks = env.core.store.tasks.list({ from_thread: chat.id, limit: 10 });
      assert.equal(tasks.length, 1);
      const task = tasks[0];
      assert.ok(task);
      assert.equal(env.core.store.threads.byTask(task.id).length, 0);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

test("delegation followed by task assignment cannot open a second executor", async () => {
  const llm = scriptedLlm((req, { system, afterTool, said }) => {
    if (system.startsWith("You are Vera")) return say("Independent findings.");
    if (!said.includes("Review once.")) return say("Review received.");
    const results = req.messages.filter((m) => m.role === "tool");
    if (!afterTool) return callTool("ask", "delegate", { agent: "vera", task: "Review the report.", wait_s: 0 });
    if (results.length === 1)
      return callTool("duplicate", "task_create", {
        title: "Review the report",
        description: "Review the report.",
        assignee: "vera",
      });
    return say("Used the existing delegation.");
  });
  const env = await startCore({ llm });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const sent = await env.client.call("threads.send", { thread: chat.id, text: "Review once." });
    await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "source completion");
    const step = env.core.store.runs.steps(sent.run.id).find((s) => s.call_id === "duplicate");
    assert.match(step?.result ?? "", /already received a delegation/);
    assert.equal(env.core.store.threads.sessions(chat.id).length, 1);
    assert.equal(env.core.store.tasks.list({ from_thread: chat.id, limit: 10 }).length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
