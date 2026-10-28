import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const taskFirst of [true, false]) {
  test(`independent goals may use the same specialist, task ${taskFirst ? "first" : "second"}`, async () => {
    const llm = scriptedLlm((req, { system, said, afterTool }) => {
      if (system.startsWith("You are Vera")) {
        const raw = String(req.messages.findLast((m) => m.role === "user")?.content);
        const task = /Task (task_\w+):/.exec(raw)?.[1];
        return task && !afterTool
          ? callTool("finish", "task_close", { task, state: "done", note: "Verified report findings." })
          : say("Delivered the independent outcome.");
      }
      if (!said.includes("Two different goals.")) return say("Results received.");
      const results = req.messages.filter((m) => m.role === "tool");
      const startTask = () =>
        callTool("task", "task_create", {
          title: "Analyze report",
          description: "Analyze the quarterly report.",
          assignee: "vera",
        });
      const delegate = () =>
        callTool("policy", "delegate", {
          agent: "vera",
          task: "Summarize the unrelated travel policy.",
          independent: true,
          wait_s: 0,
        });
      if (!afterTool) return taskFirst ? startTask() : delegate();
      if (results.length === 1) return taskFirst ? delegate() : startTask();
      return say("Both independent goals started.");
    });
    const env = await startCore({ llm });
    try {
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      const sent = await env.client.call("threads.send", { thread: chat.id, text: "Two different goals." });
      await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "independent dispatch");
      const tasks = env.core.store.tasks.list({ from_thread: chat.id, limit: 10 });
      assert.equal(tasks.length, 1);
      const task = tasks[0];
      assert.ok(task);
      assert.equal(env.core.store.threads.byTask(task.id).length, 1);
      assert.equal(env.core.store.threads.sessions(chat.id).length, 1);
      const delegated = env.core.store.runs.children(sent.run.id);
      assert.equal(delegated.length, 1);
      assert.equal(delegated[0]?.input?.task_independent, true);
      assert.ok(env.core.store.runs.steps(sent.run.id).every((s) => s.state === "ok"));
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}
