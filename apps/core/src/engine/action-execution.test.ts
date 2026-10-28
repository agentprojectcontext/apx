import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const mode of ["creation", "assignment", "batch"] as const) {
  const assign = mode === "assignment";
  test(`task ${mode} and delegation use one executor`, async () => {
    const llm = scriptedLlm((req, { said, afterTool, system }) => {
      if (system.startsWith("You are Vera")) {
        if (afterTool) return say("Task work executed.");
        const raw = String(req.messages.findLast((m) => m.role === "user")?.content);
        const id = /Task (task_\w+):/.exec(raw)?.[1];
        if (!id) return say("Redundant delegation executed.");
        return callTool("deliver", "task_close", { task: id, state: "done", note: "Verified report findings." });
      }
      if (said.includes("<task_result")) return say("Task report received.");
      if (!said.includes("Dispatch once")) return say("Done.");
      const results = req.messages.filter((m) => m.role === "tool");
      if (!afterTool) {
        const create = callTool("capture", "task_create", {
          title: "Analyze the report",
          description: "Analyze the report and return findings.",
          ...(!assign ? { assignee: "vera" } : {}),
        });
        if (mode !== "batch") return create;
        const duplicate = callTool("duplicate", "delegate", { agent: "vera", task: "Analyze that report.", wait_s: 0 });
        return {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [...(create.message.tool_calls ?? []), ...(duplicate.message.tool_calls ?? [])],
          },
        };
      }
      if (assign && results.length === 1) {
        const id = /task_\w+/.exec(String(results[0]?.content))?.[0];
        assert.ok(id);
        return callTool("assign", "task_update", { task: id, assignee: "vera" });
      }
      if (results.length === (assign ? 2 : 1))
        return callTool("duplicate", "delegate", { agent: "vera", task: "Analyze that report.", wait_s: 0 });
      return say(String(results.at(-1)?.content));
    });
    const env = await startCore({ llm });
    try {
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      const sent = await env.client.call("threads.send", { thread: chat.id, text: "Dispatch once" });
      await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "source completion");
      const steps = env.core.store.runs.steps(sent.run.id);
      assert.equal(env.core.store.threads.sessions(chat.id).length, 0, "no redundant delegation session");
      assert.match(steps.find((s) => s.call_id === "duplicate")?.result ?? "", /already received task task_/);
      const tasks = env.core.store.tasks.list({ from_thread: chat.id, limit: 10 });
      assert.equal(tasks.length, 1);
      const task = tasks[0];
      assert.ok(task);
      const sessions = env.core.store.threads.byTask(task.id);
      assert.equal(sessions.length, 1, "assignment really started the long work");
      const session = sessions[0];
      assert.ok(session);
      await waitFor(() => env.core.store.runs.list(session.id).some((r) => Boolean(r.ended_at)), "task execution");
      assert.equal(env.core.store.tasks.get(task.id)?.state, "done");
      assert.equal(env.core.store.runs.list(session.id).length, 1);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

test("capture-only records a task without execution or pressure to assign", async () => {
  const llm = scriptedLlm((req, { afterTool }) =>
    afterTool
      ? say(String(req.messages.at(-1)?.content))
      : callTool("capture", "task_create", { title: "Consider a future report", description: "Not for execution." }),
  );
  const env = await startCore({ llm });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const sent = await env.client.call("threads.send", { thread: chat.id, text: "Record this idea only." });
    await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "capture completion");
    const tasks = env.core.store.tasks.list({ from_thread: chat.id, limit: 10 });
    assert.equal(tasks.length, 1);
    const task = tasks[0];
    assert.ok(task);
    assert.equal(task.assignee, undefined);
    assert.equal(env.core.store.threads.byTask(task.id).length, 0);
    assert.match(env.core.store.runs.steps(sent.run.id)[0]?.result ?? "", /capture only, no execution started/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a simple action needs no task and receives action-first guidance", async () => {
  const llm = scriptedLlm((req, { afterTool, system }) => {
    assert.match(system, /An action request gets action with your tools/);
    assert.match(system, /not board movements as progress/);
    const create = req.tools.find((t) => t.function.name === "task_create");
    assert.match(create?.function.description ?? "", /not every action/);
    return afterTool ? say("The board is empty.") : callTool("read", "task_list", {});
  });
  const env = await startCore({ llm });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const sent = await env.client.call("threads.send", { thread: chat.id, text: "Show my tasks." });
    await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "direct action completion");
    assert.deepEqual(
      env.core.store.runs.steps(sent.run.id).map((s) => s.tool),
      ["task_list"],
    );
    assert.equal(env.core.store.tasks.list({ limit: 10 }).length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
