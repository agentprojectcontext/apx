import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

test("owner assignment proceeds through continuation and independent review without new proposal", async () => {
  const llm = scriptedLlm((req, { system, said, afterTool }) => {
    const task = /Task (task_\w+)/.exec(JSON.stringify(req.messages))?.[1] ?? "";
    if (system.startsWith("You are Vera")) {
      if (afterTool) return say("Work passed on.");
      if (said.includes("Part 2 of at most")) return callTool("review", "task_update", { task, assignee: "scout" });
      return callTool("progress", "task_comment", { task, text: "Implementation completed and checked." });
    }
    if (system.startsWith("You are Scout")) {
      if (!afterTool)
        return callTool("close", "task_close", {
          task,
          state: "done",
          note: "Reviewed the implementation and checks.",
        });
      return say("Review completed.");
    }
    return say("ok");
  });
  const env = await startCore({ llm });
  try {
    const store = env.core.store;
    const old = (title: string, parent?: string) =>
      store.tasks.create({
        title,
        status: "todo",
        parent_id: parent,
        thread_id: store.threads.create({ kind: "task", title, agent_ids: ["superagent"] }).id,
        by: "superagent",
      });
    const a = old("Old root"),
      b = old("Old phase", a.id),
      c = old("Old branch", b.id);
    const task = await env.client.call("tasks.create", {
      title: "Work to review",
      description: "Implement and ask Scout to review.",
      parent: c.id,
      assignee: "vera",
      status: "doing",
    });
    await waitFor(() => store.tasks.get(task.id)?.state === "done", "review finishes");
    const result = store.tasks.get(task.id);
    assert.notEqual(result?.proposed, true);
    assert.equal(result?.assignee, "scout");
    await waitFor(
      () =>
        store.threads
          .byTask(task.id)
          .flatMap((t) => store.runs.list(t.id, 20))
          .some((r) => r.agent_id === "scout" && r.state === "completed"),
      "review turn completes",
    );
    const runs = store.threads.byTask(task.id).flatMap((t) => store.runs.list(t.id, 20));
    assert.ok(runs.some((r) => r.agent_id === "vera" && r.input?.origin.kind === "task_continue"));
    assert.ok(runs.some((r) => r.agent_id === "scout" && r.state === "completed"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("two review rounds can return an owner-assigned task without a proposal", async () => {
  let devTurns = 0;
  const llm = scriptedLlm((req, { system, afterTool }) => {
    const task = /Task (task_\w+)/.exec(JSON.stringify(req.messages))?.[1] ?? "";
    if (system.startsWith("You are Vera")) {
      if (afterTool) return say("Handed to review.");
      devTurns++;
      if (devTurns <= 2) return callTool("review", "task_update", { task, status: "review", assignee: "scout" });
      return say("Review result received.");
    }
    if (system.startsWith("You are Scout")) {
      if (!afterTool) return callTool("return", "task_update", { task, status: "review", assignee: "vera" });
      return say("Reviewed the work.");
    }
    return say("ok");
  });
  const env = await startCore({ llm });
  try {
    const store = env.core.store;
    const old = (title: string, parent?: string) =>
      store.tasks.create({
        title,
        status: "todo",
        parent_id: parent,
        thread_id: store.threads.create({ kind: "task", title, agent_ids: ["superagent"] }).id,
        by: "superagent",
      });
    const a = old("Old root"),
      b = old("Old phase", a.id),
      c = old("Old branch", b.id);
    const task = await env.client.call("tasks.create", {
      title: "Review and return",
      description: "Implement and review.",
      parent: c.id,
      assignee: "vera",
      status: "doing",
    });
    await waitFor(
      () =>
        store.threads
          .byTask(task.id)
          .flatMap((t) => store.runs.list(t.id, 20))
          .filter((r) => r.agent_id === "vera" && r.ended_at).length >= 3,
      "author receives review",
    );
    const result = store.tasks.get(task.id);
    assert.equal(result?.assignee, "vera");
    assert.notEqual(result?.proposed, true);
    assert.ok(
      store.threads
        .byTask(task.id)
        .flatMap((t) => store.runs.list(t.id, 20))
        .filter((r) => r.agent_id === "scout" && r.state === "completed").length >= 2,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
