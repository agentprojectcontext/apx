import assert from "node:assert/strict";
import { test } from "node:test";
import { proposalProvenance, proposalReasonCode } from "../domain/proposal-provenance.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

test("reason codes do not store free text and legacy proposals remain unknown", () => {
  assert.equal(proposalReasonCode(undefined), "explicit");
  assert.equal(proposalReasonCode("it would be 4 hand-offs deep"), "task_ancestry_depth");
  assert.equal(proposalReasonCode("it gives work back up its own chain"), "task_ancestry_backflow");
  assert.equal(proposalReasonCode("it gives work back up its active chain"), "active_chain_backflow");
  assert.equal(proposalReasonCode("the active owner-authorized chain reached its handoff limit"), "handoff_limit");
  assert.equal(proposalReasonCode("the owner's earlier authorization no longer covers this run"), "authority_lost");
  assert.equal(proposalReasonCode("private-token-do-not-store"), "other");
  const legacy = [{ at: "2026", op: "create" as const, by: "owner", data: { proposed: true } }];
  assert.deepEqual(proposalProvenance(true, legacy), { reason: "unknown" });
  assert.equal(proposalProvenance(false, legacy), undefined);
  const old = [
    {
      at: "2026",
      op: "create" as const,
      by: "owner",
      data: {
        proposed: true,
        proposal_provenance: { version: 1, reason: "explicit", explicit: true, actor_scope: "non_agent" },
      },
    },
    { at: "2026", op: "update" as const, by: "owner", data: { proposed: false } },
    { at: "2026", op: "update" as const, by: "agent", data: { proposed: true } },
  ];
  assert.deepEqual(proposalProvenance(true, old), { reason: "unknown" }, "never reuse a previous proposal provenance");
  const edited = [
    {
      at: "2026",
      op: "create" as const,
      by: "owner",
      data: {
        proposed: true,
        proposal_provenance: { version: 1, reason: "explicit", explicit: true, actor_scope: "non_agent" },
      },
    },
    { at: "2026", op: "assign" as const, by: "other-agent", data: { assignee: "vera" } },
  ];
  assert.deepEqual(
    proposalProvenance(true, edited),
    { reason: "unknown" },
    "edited payload invalidates earlier provenance",
  );
  const known = [
    {
      at: "2026",
      op: "create" as const,
      by: "owner",
      data: {
        proposed: true,
        proposal_provenance: { version: 1, reason: "explicit", explicit: true, actor_scope: "non_agent" },
      },
    },
  ];
  for (const op of ["done", "drop", "reopen", "move"] as const)
    assert.deepEqual(
      proposalProvenance(true, [...known, { at: "2026", op, by: "owner", data: { project_id: "other" } }]),
      { reason: "unknown" },
    );
});

test("explicit proposal persists actor classification without implying a verified human", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const task = await env.client.call("tasks.create", {
      title: "Explicit proposal",
      description: "Synthetic only",
      assignee: "vera",
      propose: true,
    });
    assert.equal(task.proposed, true);
    const events = env.core.store.tasks.events(task.id);
    assert.deepEqual(proposalProvenance(true, events), {
      reason: "explicit",
      explicit: true,
      actor: "non_agent",
      actor_scope: "non_agent",
    });
    assert.equal(env.core.store.threads.byTask(task.id).length, 0, "provenance must not start work");
    assert.doesNotMatch(JSON.stringify(events.at(-1)), /Synthetic only/, "do not duplicate free text in provenance");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("failure to persist provenance rolls back the proposal without a phantom task", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const repo = env.core.store.tasks;
    const { DatabaseSync } = await import("node:sqlite");
    const path = await import("node:path");
    const db = new DatabaseSync(path.join(env.home, "apx.db"));
    db.exec(
      "CREATE TRIGGER fail_provenance BEFORE INSERT ON task_events WHEN json_extract(NEW.data,'$.proposal_provenance') IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected metadata failure'); END",
    );
    db.close();
    const published: string[] = [];
    const off = env.core.bus.on((e) => {
      if (e.type === "task.updated" && e.task.title === "Rollback provenance") published.push(e.task.id);
    });
    await assert.rejects(
      env.client.call("tasks.create", {
        title: "Rollback provenance",
        description: "Synthetic",
        assignee: "vera",
        propose: true,
      }),
    );
    assert.equal(
      repo.list({ limit: 100 }).some((t) => t.title === "Rollback provenance"),
      false,
    );
    assert.deepEqual(published, []);
    off();
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("accepted proposal followed by a new forced handoff records the new proposal", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const parent = store.tasks.create({
      title: "Parent cycle",
      status: "todo",
      by: "superagent",
      thread_id: store.threads.create({ kind: "task", title: "Parent cycle", agent_ids: ["superagent"] }).id,
    });
    const task = store.tasks.create({
      title: "Cycle",
      description: "Synthetic task",
      status: "todo",
      by: "superagent",
      parent_id: parent.id,
      assignee: "vera",
      thread_id: store.threads.create({ kind: "task", title: "Cycle", agent_ids: ["vera"] }).id,
    });
    const agentChat = store.threads.create({ kind: "loose", title: "Agent", agent_ids: ["vera"] });
    const { createLog } = await import("../log.ts");
    let sequence = 0;
    const transfer = () =>
      env.core.dispatch(
        "tasks.update",
        { task: task.id, assignee: "superagent" },
        {
          transport: "internal",
          role: "operator",
          actor: "agent",
          session: undefined,
          log: createLog("test", true),
          agent: { id: "vera", thread_id: agentChat.id, run_id: "cycle" },
        },
        `cycle-${++sequence}`,
      );
    assert.equal((await transfer()).ok, true);
    assert.equal(proposalProvenance(true, store.tasks.events(task.id))?.reason, "task_ancestry_backflow");
    await env.client.call("tasks.update", { task: task.id, proposed: false });
    assert.equal(store.tasks.get(task.id)?.proposed, undefined);
    await env.client.call("tasks.update", { task: task.id, assignee: "vera" });
    assert.equal((await transfer()).ok, true);
    const events = store.tasks.events(task.id);
    assert.equal(events.filter((e) => e.data.proposal_provenance).length, 2);
    assert.deepEqual(proposalProvenance(true, events), {
      reason: "task_ancestry_backflow",
      explicit: false,
      actor: "vera",
      actor_scope: "agent",
    });
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("forced handoff rolls back state and events if provenance write fails", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const parent = store.tasks.create({
      title: "Rollback parent",
      status: "todo",
      by: "superagent",
      thread_id: store.threads.create({ kind: "task", title: "Rollback parent", agent_ids: ["superagent"] }).id,
    });
    const task = store.tasks.create({
      title: "Rollback handoff",
      description: "Synthetic",
      status: "todo",
      by: "superagent",
      parent_id: parent.id,
      assignee: "vera",
      thread_id: store.threads.create({ kind: "task", title: "Rollback handoff", agent_ids: ["vera"] }).id,
    });
    const chat = store.threads.create({ kind: "loose", title: "Agent", agent_ids: ["vera"] });
    const published: string[] = [];
    const off = env.core.bus.on((e) => {
      if (e.type === "task.updated" && e.task.id === task.id) published.push(e.task.id);
    });
    const before = store.tasks.events(task.id).length;
    const { DatabaseSync } = await import("node:sqlite");
    const path = await import("node:path");
    const db = new DatabaseSync(path.join(env.home, "apx.db"));
    db.exec(
      "CREATE TRIGGER fail_provenance BEFORE INSERT ON task_events WHEN json_extract(NEW.data,'$.proposal_provenance') IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected provenance failure'); END",
    );
    db.close();
    const { createLog } = await import("../log.ts");
    const response = await env.core.dispatch(
      "tasks.update",
      { task: task.id, assignee: "superagent" },
      {
        transport: "internal",
        role: "operator",
        actor: "agent",
        session: undefined,
        log: createLog("test", true),
        agent: { id: "vera", thread_id: chat.id, run_id: "rollback" },
      },
      "rollback-update",
    );
    assert.equal(response.ok, false);
    assert.equal(store.tasks.get(task.id)?.assignee, "vera");
    assert.equal(store.tasks.get(task.id)?.proposed, undefined);
    assert.equal(store.tasks.events(task.id).length, before);
    assert.deepEqual(published, []);
    off();
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
