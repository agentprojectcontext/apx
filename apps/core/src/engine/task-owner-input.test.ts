import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const llm = () =>
  scriptedLlm((req, { said, afterTool }) => {
    if (afterTool) {
      if (String(req.messages.at(-1)?.content).includes("The owner answered: only the color"))
        return callTool("follow-up", "ask_owner", { question: "Which size should I use?" });
      return say("Answer received; the task still needs verification.");
    }
    if (req.messages.some((m) => m.role === "tool")) return say("Work resumed.");
    if (said.includes("Their answer: only the color"))
      return callTool("follow-up", "ask_owner", { question: "Which size should I use?" });
    if (said.includes("accepted the action") || said.includes("declined the action") || said.includes("Their answer:"))
      return say("Decision received.");
    if (said.includes("Approval test"))
      return callTool("approval", "ask_owner", { action: "Use blue for the draft in this task." });
    if (said.includes("Question test") || said.includes("Partial answer"))
      return callTool("question", "ask_owner", { question: "Which color and size should I use?" });
    return say("Work noted.");
  });

type Env = Awaited<ReturnType<typeof startCore>>;
async function pending(env: Env, task: string) {
  let found: ReturnType<Env["core"]["store"]["inputs"]["pending"]>[number] | undefined;
  await waitFor(() => {
    const sessions = env.core.store.threads.byTask(task);
    found = sessions.flatMap((t) => env.core.store.inputs.pending(t.id))[0];
    return Boolean(found);
  }, "task input");
  assert.ok(found);
  return found;
}
function executions(env: Env, thread: string) {
  return env.core.store.runs.list(thread).filter((r) => r.input?.origin.kind !== "task_continue");
}
async function cleanup(env: Env) {
  await env.core.close();
  await env.cleanup();
}

for (const decision of ["approve", "deny"] as const) {
  test(`a task action ${decision} settles its native wait without finishing or duplicating its live run`, async () => {
    const env = await startCore({ llm: llm() });
    try {
      const task = await env.client.call("tasks.create", {
        title: "Approval test",
        description: "Prepare a draft after the owner's decision.",
        assignee: "superagent",
        status: "doing",
      });
      const input = await pending(env, task.id);
      assert.equal(env.core.store.tasks.get(task.id)?.awaits_owner, true);
      await env.client.call("runs.respond", { input: input.id, decision });
      await env.settle(input.thread_id);
      const current = env.core.store.tasks.get(task.id);
      assert.equal(current?.awaits_owner, false);
      assert.equal(current?.state, "open");
      assert.equal(current?.status, "doing");
      assert.equal(
        executions(env, input.thread_id).length,
        1,
        "the live listener resumes rather than admitting another executor",
      );
      assert.equal(env.core.store.inputs.get(input.id)?.state, decision === "approve" ? "approved" : "denied");
      await assert.rejects(env.client.call("runs.respond", { input: input.id, decision }));
      await env.settle(input.thread_id);
      assert.equal(executions(env, input.thread_id).length, 1);
    } finally {
      await cleanup(env);
    }
  });
}

test("a partial answer leads to a new native wait, never a completed task", async () => {
  const env = await startCore({ llm: llm() });
  try {
    const task = await env.client.call("tasks.create", {
      title: "Partial answer",
      description: "Collect both choices before preparing the draft.",
      assignee: "superagent",
      status: "doing",
    });
    const first = await pending(env, task.id);
    await env.client.call("runs.respond", { input: first.id, text: "only the color" });
    const second = await pending(env, task.id);
    assert.notEqual(second.id, first.id);
    assert.equal(env.core.store.tasks.get(task.id)?.awaits_owner, true);
    assert.equal(env.core.store.tasks.get(task.id)?.state, "open");
    await env.client.call("runs.respond", { input: second.id, text: "Small" });
    await env.settle(second.thread_id);
    assert.equal(env.core.store.tasks.get(task.id)?.awaits_owner, false);
  } finally {
    await cleanup(env);
  }
});

test("a separate manual blocker survives an answer and unrelated messages", async () => {
  const env = await startCore({ llm: llm() });
  try {
    const task = await env.client.call("tasks.create", {
      title: "Question test",
      description: "Collect draft choices.",
      assignee: "superagent",
      status: "doing",
    });
    const input = await pending(env, task.id);
    await env.client.call("tasks.update", { task: task.id, awaits_owner: true });
    await env.client.call("tasks.comment", { task: task.id, text: "Privacy review is still unresolved." });
    await env.client.call("runs.respond", { input: input.id, text: "Blue, small" });
    await env.settle(input.thread_id);
    assert.equal(env.core.store.tasks.get(task.id)?.awaits_owner, true);
    const runsBefore = executions(env, input.thread_id).length;
    await env.client.call("tasks.update", { task: task.id, awaits_owner: false });
    await env.settle(input.thread_id);
    assert.equal(env.core.store.tasks.get(task.id)?.awaits_owner, false);
    assert.equal(executions(env, input.thread_id).length, runsBefore + 1);
    await env.client.call("tasks.update", { task: task.id, awaits_owner: false });
    assert.equal(executions(env, input.thread_id).length, runsBefore + 1, "repeated release does not start twice");
  } finally {
    await cleanup(env);
  }
});

test("an owner edit cannot clear an unanswered native card or start a second executor", async () => {
  const env = await startCore({ llm: llm() });
  try {
    const task = await env.client.call("tasks.create", {
      title: "Question test",
      description: "Collect draft choices.",
      assignee: "superagent",
      status: "doing",
    });
    const input = await pending(env, task.id);
    await env.client.call("tasks.update", { task: task.id, awaits_owner: false });
    assert.equal(env.core.store.tasks.get(task.id)?.awaits_owner, true);
    assert.equal(executions(env, input.thread_id).length, 1);
    await env.client.call("runs.respond", { input: input.id, text: "Blue, small" });
    await env.settle(input.thread_id);
    assert.equal(env.core.store.tasks.get(task.id)?.awaits_owner, false);
  } finally {
    await cleanup(env);
  }
});

test("outside apps and agent callers cannot answer or release the owner's native task wait", async () => {
  const env = await startCore({ llm: llm() });
  try {
    const task = await env.client.call("tasks.create", {
      title: "Question test",
      description: "Collect draft choices.",
      assignee: "superagent",
      status: "doing",
    });
    const input = await pending(env, task.id);
    const made = await env.client.call("clients.create", { name: "Acme app", scopes: ["chat"] });
    const external = new ApxClient({ url: env.core.url, clientToken: made.token });
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(external.call("runs.respond", { input: input.id, text: "Blue" }));
    await assert.rejects(external.call("tasks.update", { task: task.id, awaits_owner: false }));
    await assert.rejects(agent.call("runs.respond", { input: input.id, text: "Blue" }));
    assert.equal(env.core.store.inputs.get(input.id)?.state, "pending");
    assert.equal(env.core.store.tasks.get(task.id)?.awaits_owner, true);
    assert.equal(executions(env, input.thread_id).length, 1);
    await env.client.call("runs.respond", { input: input.id, text: "Blue, small" });
    await env.settle(input.thread_id);
  } finally {
    await cleanup(env);
  }
});

test("a persisted task question survives a restart and its answer admits exactly one replacement run", async () => {
  const first = await startCore({ llm: llm() });
  let second: Env | undefined;
  try {
    const task = await first.client.call("tasks.create", {
      title: "Question test",
      description: "Collect draft choices.",
      assignee: "superagent",
      status: "doing",
    });
    const input = await pending(first, task.id);
    assert.equal(first.core.store.tasks.get(task.id)?.awaits_owner, true);
    await first.core.close();
    second = await startCore({ llm: llm(), home: first.home });
    assert.equal(second.core.store.tasks.get(task.id)?.awaits_owner, true);
    await second.client.call("runs.respond", { input: input.id, text: "Blue, small" });
    const result = await second.settle(input.thread_id);
    assert.equal(second.core.store.tasks.get(task.id)?.awaits_owner, false);
    assert.equal(executions(second, input.thread_id).length, 2);
    assert.equal(result.runs.filter((r) => r.state === "completed").length >= 1, true);
    assert.equal(executions(second, input.thread_id).filter((r) => r.input?.origin.kind === "input_answer").length, 1);
    await assert.rejects(second.client.call("runs.respond", { input: input.id, text: "Blue, small" }));
    await second.settle(input.thread_id);
    assert.equal(executions(second, input.thread_id).length, 2);
  } finally {
    if (second) await second.core.close();
    else await first.core.close();
    await first.cleanup();
  }
});
