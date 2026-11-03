import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { afterWorkTurn } from "./task-work.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

test("a review return informs the coordinator so another ready task can start", async () => {
  let first = "",
    second = "",
    firstDevTurns = 0;
  const project = "feedback-project",
    lead = "feedback-lead",
    developer = "feedback-dev",
    qa = "feedback-qa",
    other = "feedback-other";
  const llm = scriptedLlm((req, { system, said, afterTool }) => {
    if (afterTool) return say("Reviewed and verified.");
    const task = /Task (task_\w+)/.exec(JSON.stringify(req.messages))?.[1] ?? "";
    if (system.startsWith("You are Feedback Lead")) {
      if (said.includes("<task_feedback") && said.includes(first))
        return callTool("next", "task_update", { task: second, assignee: other });
      if (!said.includes("<task_feedback"))
        return callTool("first", "task_update", { task: first, assignee: developer });
      return say("No work is ready.");
    }
    if (system.startsWith("You are Feedback Developer")) {
      firstDevTurns++;
      return firstDevTurns === 1
        ? callTool("review", "task_update", { task, status: "review", assignee: qa })
        : say("Review received.");
    }
    if (system.startsWith("You are Feedback Reviewer"))
      return callTool("return", "task_update", { task, status: "review", assignee: developer });
    if (system.startsWith("You are Feedback Other"))
      return callTool("close", "task_close", { task, state: "done", note: "Completed and verified." });
    return say("ok");
  });
  const env = await startCore({ llm });
  try {
    const store = env.core.store;
    store.projects.upsert({ id: project, name: "Feedback" });
    for (const [id, name, parent, head] of [
      [lead, "Feedback Lead", undefined, true],
      [developer, "Feedback Developer", lead, false],
      [qa, "Feedback Reviewer", lead, false],
      [other, "Feedback Other", lead, false],
    ] as const)
      store.agents.upsertApc({
        id,
        name,
        parent,
        project_id: project,
        slug: id,
        role: name,
        prompt: "",
        extra: head ? { orchestrator: true } : {},
      });
    const old = (title: string, parent?: string) =>
      store.tasks.create({
        title,
        status: "todo",
        project_id: project,
        parent_id: parent,
        thread_id: store.threads.create({ kind: "task", title, project_id: project, agent_ids: [lead] }).id,
        by: developer,
      });
    const a = old("Old root"),
      b = old("Old phase", a.id),
      c = old("Old branch", b.id);
    const ready = (title: string) =>
      store.tasks.create({
        title,
        description: "Perform and verify bounded work.",
        status: "doing",
        project_id: project,
        parent_id: c.id,
        assignee: lead,
        thread_id: store.threads.create({ kind: "task", title, project_id: project, agent_ids: [lead] }).id,
        by: developer,
      });
    first = ready("Review first work").id;
    second = ready("Independent next work").id;
    const chat = await env.client.call("threads.create", {
      kind: "loose",
      title: "Coordinate",
      agent_id: lead,
      project_id: project,
    });
    await env.client.call("threads.send", { thread: chat.id, text: "Coordinate ready work." });
    await waitFor(() => store.tasks.get(second)?.state === "done", "review feedback leads to the next task", {
      ms: 10000,
    });
    assert.notEqual(store.tasks.get(first)?.proposed, true);
    assert.equal(store.tasks.get(second)?.state, "done");
    const feedback = store.runs.list(chat.id, 20).filter((run) => run.input?.origin.kind === "task_feedback");
    assert.equal(feedback.length, 1);
    const origin = feedback[0]?.input?.origin;
    assert.equal(origin?.kind, "task_feedback");
    if (origin?.kind !== "task_feedback") throw new Error("missing feedback origin");
    const review = store.runs.get(origin.run_id);
    assert.ok(review);
    afterWorkTurn(store, env.core.engine.admit, review);
    assert.equal(store.runs.list(chat.id, 20).filter((run) => run.input?.origin.kind === "task_feedback").length, 1);
    const firstTask = store.tasks.get(first);
    assert.ok(firstTask);
    store.threads.mergeContext(firstTask.thread_id, { coordination_feedback: [] });
    afterWorkTurn(store, env.core.engine.admit, { ...review, state: "failed" });
    assert.ok(review.input);
    afterWorkTurn(store, env.core.engine.admit, { ...review, input: { ...review.input, origin: { kind: "user" } } });
    store.tasks.change(first, { proposed: true }, "owner");
    afterWorkTurn(store, env.core.engine.admit, review);
    assert.equal(
      store.runs.list(chat.id, 20).filter((run) => run.input?.origin.kind === "task_feedback").length,
      1,
      "failed, untrusted and proposed turns do not generate feedback",
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
