import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import type { Harness } from "../harness/index.ts";
import { createLog } from "../log.ts";
import type { CallContext } from "../rpc/context.ts";
import { taskHandlers } from "../rpc/tasks.ts";
import { assertPath, tempDir, waitFor } from "../testkit/platform.ts";
import { handedOff } from "./task-handoff.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// The second call in the creation batch must not run after ownership transfers.
test("self-assignment transfers execution, preserves findings and reports back without duplicate tools", async () => {
  let source = "";
  let task = "";
  let sourceFinalTools = -1;
  let incoming = "";
  const llm = scriptedLlm((req, { said, afterTool }) => {
    if (said.includes("<task_result")) return say("Task delivered.");
    if (said.includes("Work on this task.")) {
      incoming = String(req.messages.findLast((m) => m.role === "user")?.content);
      task = /Task (task_\w+):/.exec(incoming)?.[1] ?? "";
      if (!afterTool) return callTool("close", "task_close", { task, state: "done", note: "Verified." });
      return say("Transferred task finished.");
    }
    if (said.includes("independent follow-up")) {
      if (!afterTool) return callTool("independent", "task_list", {});
      return say("Independent request handled.");
    }
    const results = req.messages.filter((m) => m.role === "tool");
    if (!results.length) return callTool("findings", "task_list", {});
    if (results.length === 1) {
      const create = callTool("transfer", "task_create", {
        title: "Single execution goal",
        description: "Use the existing findings and finish.",
        assignee: "roby",
      });
      const duplicate = callTool("duplicate", "task_list", {});
      return {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [...(create.message.tool_calls ?? []), ...(duplicate.message.tool_calls ?? [])],
        },
      };
    }
    sourceFinalTools = req.tools.length;
    return say("Work transferred.");
  });
  const env = await startCore({ llm });
  try {
    const chat = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "roby",
      title: "Single execution",
    });
    source = chat.id;
    const sent = await env.client.call("threads.send", {
      thread: source,
      text: "Investigate once and transfer the goal.",
    });
    await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "source run completion");
    const steps = env.core.store.runs.steps(sent.run.id);
    assert.deepEqual(
      steps.map((s) => s.call_id),
      ["findings", "transfer"],
      "remaining tools in the same batch cannot execute",
    );
    assert.equal(sourceFinalTools, 0, "the originating turn may only summarize after transfer");
    await waitFor(() => Boolean(task && env.core.store.tasks.get(task)?.state === "done"), "task delivery");
    assert.match(incoming, /Existing work transferred/);
    assert.ok(incoming.includes(source));
    assert.match(incoming, /Investigate once and transfer the goal/);
    assert.match(incoming, /task_list/);
    const resumed = env.core.store.runs.create({
      thread_id: source,
      agent_id: "roby",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Resume after restart.", resume_of: sent.run.id },
      deadline_at: "9999-01-01T00:00:00Z",
    });
    assert.match(handedOff(env.core.store, resumed) ?? "", /Execution transferred/);
    env.core.store.runs.setState(resumed, "completed");
    await waitFor(
      () =>
        env.core.store.runs.list(source).some((r) => r.input?.origin.kind === "task_result" && r.state === "completed"),
      "self-handoff closing report",
    );
    const next = await env.client.call("threads.send", { thread: source, text: "independent follow-up" });
    await waitFor(() => Boolean(env.core.store.runs.get(next.run.id)?.ended_at), "independent request completion");
    assert.deepEqual(
      env.core.store.runs.steps(next.run.id).map((s) => s.call_id),
      ["independent"],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("creating a self-task after delegation is refused without starting duplicate research", async () => {
  const llm = scriptedLlm((req, { said }) => {
    if (said.includes("Research subscription limits")) return say("Existing research results.");
    const tools = req.messages.filter((m) => m.role === "tool");
    if (!tools.length)
      return callTool("research", "delegate", {
        worker: { name: "Existing research", instructions: "Research the requested topic; do not delegate." },
        task: "Research subscription limits",
        wait_s: 60,
      });
    if (tools.length === 1)
      return callTool("duplicate-task", "task_create", {
        title: "Duplicated subscription research",
        description: "Research subscription limits again.",
        assignee: "roby",
      });
    return say(String(tools.at(-1)?.content));
  });
  const env = await startCore({ llm });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const sent = await env.client.call("threads.send", { thread: chat.id, text: "Research then create a self task." });
    await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "source run completion");
    const result = env.core.store.runs.steps(sent.run.id).find((s) => s.call_id === "duplicate-task");
    assert.equal(result?.state, "error");
    assert.match(result?.result ?? "", /already delegated/);
    assert.equal((await env.client.call("tasks.list", {})).tasks.length, 0);
    assert.equal(env.core.store.threads.children(chat.id).length, 1, "the original research is retained");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a failed handoff rolls back creation and reassignment with their session and source marker", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const source = env.core.store.runs.create({
      thread_id: chat.id,
      agent_id: "roby",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Transfer once." },
      deadline_at: "9999-01-01T00:00:00Z",
    });
    env.core.store.runs.setState(source, "working");
    const ctx: CallContext = {
      role: "operator",
      actor: "agent",
      transport: "internal",
      session: undefined,
      log: createLog("test", true),
      agent: { id: "roby", thread_id: chat.id, run_id: source.id },
    };
    const handlers = taskHandlers(
      env.core.store,
      {
        ...env.core.engine,
        admit: () => {
          throw new Error("queue unavailable");
        },
      },
      env.home,
    );
    const before = env.core.store.threads.list({ include_subthreads: true }).length;
    assert.throws(
      () =>
        handlers["tasks.create"]({ title: "No partial handoff", description: "Finish once.", assignee: "roby" }, ctx),
      /queue unavailable/,
    );
    assert.equal((await env.client.call("tasks.list", {})).tasks.length, 0);
    assert.equal(env.core.store.threads.list({ include_subthreads: true }).length, before);
    assert.equal(env.core.store.threads.context(chat.id).task_handoff, undefined);
    const draft = await env.client.call("tasks.create", { title: "Keep draft", description: "Finish once." });
    assert.throws(() => handlers["tasks.update"]({ task: draft.id, assignee: "roby" }, ctx), /queue unavailable/);
    assert.equal(env.core.store.tasks.get(draft.id)?.assignee, undefined);
    assert.equal(env.core.store.threads.byTask(draft.id).length, 0);
    assert.equal(env.core.store.threads.context(chat.id).task_handoff, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

for (const busy of ["helper", "job", "queued turn", "tool"] as const) {
  test(`a source with an active ${busy} cannot persist a second executor`, async () => {
    let env: Awaited<ReturnType<typeof startCore>>;
    let source = "";
    const llm = scriptedLlm((_req, { afterTool }) => {
      if (afterTool) return say("Continue with the existing work.");
      if (busy === "helper") {
        const child = env.core.store.threads.create({
          kind: "a2a",
          title: "Existing helper",
          agent_ids: ["roby"],
          parent_id: source,
        });
        env.core.store.runs.create({
          thread_id: child.id,
          agent_id: "roby",
          trigger: "a2a",
          input: { origin: { kind: "user" }, text: "Existing helper work." },
          deadline_at: "9999-01-01T00:00:00Z",
        });
      } else if (busy === "tool") {
        const run = env.core.store.runs.list(source).find((r) => !r.ended_at);
        assert.ok(run);
        env.core.store.runs.beginStep(run.id, { call_id: "in-flight", tool: "file_write", args: {}, effect: "local" });
      } else if (busy === "job") {
        env.core.store.jobs.create({
          thread_id: source,
          agent_id: "roby",
          title: "Existing job",
          cwd: env.home,
          background: true,
        });
      } else {
        env.core.store.runs.create({
          thread_id: source,
          agent_id: "roby",
          trigger: "user",
          state: "queued",
          input: { origin: { kind: "user" }, text: "Queued work." },
          deadline_at: "9999-01-01T00:00:00Z",
        });
      }
      return callTool("transfer", "task_create", {
        title: "No second executor",
        description: "Keep the existing work.",
        assignee: "roby",
      });
    });
    env = await startCore({ llm });
    try {
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      source = chat.id;
      const sent = await env.client.call("threads.send", {
        thread: source,
        text: "Try a self task while work is active.",
      });
      await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "busy source completion");
      assert.equal((await env.client.call("tasks.list", {})).tasks.length, 0);
      assert.equal(env.core.store.runs.steps(sent.run.id).find((step) => step.call_id === "transfer")?.state, "error");
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

for (const mode of ["draft", "proposal", "scheduled", "other agent"] as const) {
  test(`${mode} creation does not transfer the originating turn`, async () => {
    const llm = scriptedLlm((req, { said }) => {
      if (said.includes("Work on this task.")) return say("Other task finished.");
      const count = req.messages.filter((m) => m.role === "tool").length;
      if (!count)
        return callTool("create", "task_create", {
          title: `Independent ${mode}`,
          description: mode === "draft" ? undefined : "Separate work.",
          assignee: mode === "other agent" ? "vera" : "roby",
          ...(mode === "proposal" ? { propose: true } : {}),
          ...(mode === "scheduled" ? { start_at: "9999-01-01T00:00:00Z" } : {}),
        });
      if (count === 1) return callTool("still-working", "task_list", {});
      return say("Source remains active.");
    });
    const env = await startCore({ llm });
    try {
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      const sent = await env.client.call("threads.send", { thread: chat.id, text: `Create ${mode}.` });
      await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "source completion");
      assert.deepEqual(
        env.core.store.runs.steps(sent.run.id).map((s) => s.call_id),
        ["create", "still-working"],
      );
      assert.equal(env.core.store.threads.context(chat.id).task_handoff, undefined);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

test("assigning an existing draft to self also transfers execution", async () => {
  const llm = scriptedLlm((req, { said }) => {
    if (said.includes("Work on this task.")) return say("Task owns execution.");
    const tools = req.messages.filter((m) => m.role === "tool");
    if (!tools.length)
      return callTool("draft", "task_create", { title: "Draft transfer", description: "Finish this work." });
    if (tools.length === 1)
      return callTool("assign", "task_update", {
        task: /created (task_\w+)/.exec(String(tools[0]?.content))?.[1],
        assignee: "roby",
      });
    assert.equal(req.tools.length, 0);
    return say("Transferred the draft.");
  });
  const env = await startCore({ llm });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const sent = await env.client.call("threads.send", { thread: chat.id, text: "Create a draft and assign it." });
    await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "draft transfer");
    assert.ok(env.core.store.threads.context(chat.id).task_handoff);
    assert.deepEqual(
      env.core.store.runs.steps(sent.run.id).map((s) => s.call_id),
      ["draft", "assign"],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("external harness handoff refuses further APX and native tools and preserves the source workspace", async () => {
  const folder = tempDir("apx-handoff-");
  let approvals: boolean[] = [];
  let target = "";
  const claude: Harness = {
    id: "claude",
    async run(io) {
      const result = await io.execute("transfer", "task_create", {
        title: "External transfer",
        description: "Finish once.",
        assignee: "roby",
      });
      assert.equal(result.ok, true);
      assert.equal(result.endTurn, true);
      target = /created (task_\w+)/.exec(result.text)?.[1] ?? "";
      approvals = [
        await io.approve({ callId: "read", title: "Read file", kind: "read" }),
        await io.approve({ callId: "write", title: "Edit file", kind: "edit" }),
      ];
      const after = await io.execute("late", "task_list", {});
      assert.equal(after.ok, false);
      return { text: "Transferred.", model: "fake/fake-1" };
    },
  };
  const env = await startCore({ llm: scriptedLlm(() => say("Task session ready.")), harnesses: { claude } });
  const ws = await new ApxClient({ url: env.core.url }).connect();
  try {
    const project = await ws.call("projects.register", { path: folder.path, init: true });
    const chat = await ws.call("threads.create", {
      kind: "code",
      agent_id: "roby",
      project_id: project.project.id,
      cwd: folder.path,
      write: "read-only",
      engine: "claude",
    });
    const sent = await ws.call("threads.send", { thread: chat.id, text: "Transfer once." });
    await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "external transfer");
    assert.deepEqual(approvals, [false, false]);
    const sessions = env.core.store.threads.byTask(target);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.write, "read-only");
    assertPath(sessions[0]?.cwd, folder.path);
    assert.deepEqual(
      env.core.store.runs.steps(sent.run.id).map((s) => s.call_id),
      ["transfer"],
    );
  } finally {
    ws.close();
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});
