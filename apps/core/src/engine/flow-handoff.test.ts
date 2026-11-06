import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "@apx/protocol/flow-graph";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const [kind, preexistingProposal] of [
  ["schedule", false],
  ["webhook", false],
  ["schedule", true],
] as const) {
  test(`${kind} flow preserves approval boundaries (proposal=${preexistingProposal})`, async () => {
    let now = new Date("2026-11-02T10:02:00Z");
    let taskId = "";
    const llm = scriptedLlm((_req, { system, afterTool }) => {
      if (system.startsWith("You are Flow Lead") && !afterTool)
        return callTool("assign", "task_update", { task: taskId, assignee: "flow-worker" });
      return say("Done.");
    });
    const env = await startCore({ llm, clock: () => now });
    try {
      const store = env.core.store;
      const project = (await env.client.call("projects.create", { name: "Flow matrix" })).project.id;
      store.agents.upsertApc({
        id: "flow-lead",
        name: "Flow Lead",
        project_id: project,
        slug: "flow-lead",
        role: "Lead",
        prompt: "",
        extra: { orchestrator: true },
      });
      store.agents.upsertApc({
        id: "flow-worker",
        name: "Flow Worker",
        project_id: project,
        parent: "flow-lead",
        slug: "flow-worker",
        role: "Worker",
        prompt: "",
        extra: {},
      });
      const old = (title: string, parent?: string) =>
        store.tasks.create({
          title,
          status: "todo",
          project_id: project,
          parent_id: parent,
          thread_id: store.threads.create({ kind: "task", title, project_id: project, agent_ids: ["flow-lead"] }).id,
          by: "flow-worker",
        });
      const a = old("Old root"),
        b = old("Old stage", a.id),
        c = old("Old branch", b.id);
      const task = store.tasks.create({
        title: "Existing ready work",
        description: "Perform a bounded change.",
        status: "doing",
        project_id: project,
        parent_id: c.id,
        assignee: "flow-lead",
        thread_id: store.threads.create({
          kind: "task",
          title: "Existing ready work",
          project_id: project,
          agent_ids: ["flow-lead"],
        }).id,
        by: "flow-worker",
      });
      if (preexistingProposal) store.tasks.change(task.id, { proposed: true }, "owner");
      taskId = task.id;
      const id = "scheduled-coordination";
      await env.client.call("flows.set", {
        id,
        projectId: project,
        name: "Scheduled coordination",
        enabled: false,
        predicates: [],
        tableKey: "latest",
        action: { kind: "none" },
      });
      const graph: FlowGraph = {
        schemaVersion: 2,
        nodes: [
          kind === "schedule"
            ? { id: "tick", kind: "schedule", label: "Every 5 minutes", cron: "*/5 * * * *" }
            : { id: "tick", kind: "webhook", label: "External event" },
          {
            id: "work",
            kind: "agent",
            label: "Coordinate",
            agent: "flow-lead",
            prompt: "Coordinate ready work.",
            input: { kind: "event", path: [] },
            autonomy: "total",
            delegate: true,
          },
        ],
        edges: [{ source: "tick", target: "work" }],
        layout: [],
      };
      const draft = await env.client.call("flows.draft_save", { flow: id, expectedVersion: null, graph });
      await env.client.call("flows.publish", {
        flow: id,
        expectedDraftVersion: draft.draftVersion ?? 0,
        expectedPublishedRevision: null,
      });
      const flow = store.flows.get(id);
      assert.ok(flow);
      await env.client.call("flows.set", { ...flow, enabled: true });
      if (kind === "schedule") {
        env.core.scheduler.tick();
        now = new Date("2026-11-02T10:05:10Z");
        env.core.scheduler.tick();
      } else {
        const route = env.core.flows.routes(`/flows/${id}`);
        assert.ok(route);
        const response = await route.handle(
          {
            method: "POST",
            path: `/flows/${id}`,
            headers: { "content-type": "application/json" },
            body: Buffer.from(JSON.stringify({ id: "external-event", data: { text: "external request" } })),
          },
          new AbortController().signal,
        );
        assert.equal(response.status, 202);
      }
      const event = await waitFor(() => store.flows.events(id, 10).find((e) => e.state !== "pending"), "flow finishes");
      const graphRun = store.flowGraphRuns.load(id, event.event_id);
      const step = graphRun?.steps.get("work");
      assert.ok(step?.run_id && step.thread_id);
      assert.equal(
        store.flowGraphRuns.scheduledAgentRun(id, step.run_id, step.thread_id, project),
        kind === "schedule",
      );
      assert.equal(store.flowGraphRuns.scheduledAgentRun(id, step.run_id, step.thread_id, "wrong-project"), false);
      assert.equal(store.flowGraphRuns.scheduledAgentRun(id, step.run_id, "wrong-thread", project), false);
      const after = store.tasks.get(task.id);
      if (kind === "schedule" && !preexistingProposal) {
        assert.notEqual(after?.proposed, true);
        await waitFor(
          () => store.threads.byTask(task.id).some((t) => t.agent_ids[0] === "flow-worker"),
          "worker starts",
        );
      } else {
        assert.equal(after?.proposed, true);
        assert.equal(store.threads.byTask(task.id).filter((t) => t.agent_ids[0] === "flow-worker").length, 0);
      }
      if (kind === "schedule") {
        const current = store.flows.get(id);
        assert.ok(current);
        await env.client.call("flows.set", { ...current, enabled: false });
        assert.equal(
          store.flowGraphRuns.scheduledAgentRun(id, step.run_id, step.thread_id, project),
          false,
          "disabled flow cannot confer authority",
        );
        now = new Date("2026-11-02T10:07:00Z");
        await env.client.call("flows.set", { ...current, enabled: true });
        assert.equal(
          store.flowGraphRuns.scheduledAgentRun(id, step.run_id, step.thread_id, project),
          false,
          "re-enabling a flow does not revive a previous event's authority",
        );
      }
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

test("a scheduled coordinator receives a completed task and starts another without another tick", async () => {
  let now = new Date("2026-11-02T10:02:00Z");
  let first = "",
    second = "";
  const llm = scriptedLlm((req, { system, said, afterTool }) => {
    if (afterTool) return say("Step completed.");
    if (system.startsWith("You are Scheduled Lead")) {
      if (said.includes("<task_result") && said.includes(first))
        return callTool("second", "task_update", { task: second, assignee: "scheduled-worker" });
      if (!said.includes("<task_result"))
        return callTool("first", "task_update", { task: first, assignee: "scheduled-worker" });
      return say("All delivered.");
    }
    if (system.startsWith("You are Scheduled Worker")) {
      const task = /Task (task_\w+)/.exec(JSON.stringify(req.messages))?.[1] ?? "";
      return callTool("close", "task_close", { task, state: "done", note: "Completed and verified." });
    }
    return say("ok");
  });
  const env = await startCore({ llm, clock: () => now });
  try {
    const store = env.core.store;
    const project = (await env.client.call("projects.create", { name: "Scheduled continuity" })).project.id;
    store.agents.upsertApc({
      id: "scheduled-lead",
      name: "Scheduled Lead",
      project_id: project,
      slug: "lead",
      role: "Lead",
      prompt: "",
      extra: { orchestrator: true },
    });
    store.agents.upsertApc({
      id: "scheduled-worker",
      name: "Scheduled Worker",
      project_id: project,
      parent: "scheduled-lead",
      slug: "worker",
      role: "Worker",
      prompt: "",
      extra: {},
    });
    const old = (title: string, parent?: string) =>
      store.tasks.create({
        title,
        status: "todo",
        project_id: project,
        parent_id: parent,
        thread_id: store.threads.create({ kind: "task", title, project_id: project, agent_ids: ["scheduled-lead"] }).id,
        by: "scheduled-worker",
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
        assignee: "scheduled-lead",
        thread_id: store.threads.create({ kind: "task", title, project_id: project, agent_ids: ["scheduled-lead"] }).id,
        by: "scheduled-worker",
      });
    first = ready("First task").id;
    second = ready("Second task").id;
    const id = "scheduled-continuity";
    await env.client.call("flows.set", {
      id,
      projectId: project,
      name: "Schedule",
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    const graph: FlowGraph = {
      schemaVersion: 2,
      nodes: [
        { id: "tick", kind: "schedule", label: "Every 5 minutes", cron: "*/5 * * * *" },
        {
          id: "work",
          kind: "agent",
          label: "Coordinate",
          agent: "scheduled-lead",
          prompt: "Coordinate ready work.",
          input: { kind: "event", path: [] },
          autonomy: "total",
          delegate: true,
        },
      ],
      edges: [{ source: "tick", target: "work" }],
      layout: [],
    };
    const draft = await env.client.call("flows.draft_save", { flow: id, expectedVersion: null, graph });
    await env.client.call("flows.publish", {
      flow: id,
      expectedDraftVersion: draft.draftVersion ?? 0,
      expectedPublishedRevision: null,
    });
    const flow = store.flows.get(id);
    assert.ok(flow);
    await env.client.call("flows.set", { ...flow, enabled: true });
    env.core.scheduler.tick();
    now = new Date("2026-11-02T10:05:10Z");
    env.core.scheduler.tick();
    await waitFor(
      () => store.tasks.get(second)?.state === "done",
      "the coordinator starts the next task after feedback",
      { ms: 10000 },
    );
    assert.equal(store.tasks.get(first)?.state, "done");
    assert.notEqual(store.tasks.get(second)?.proposed, true);
    assert.equal(store.flows.events(id, 10).length, 1, "no second schedule tick was needed");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
