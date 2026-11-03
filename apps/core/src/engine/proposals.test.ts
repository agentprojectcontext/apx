// Agents hand work on through tasks without passing it to and fro: past a few hand-offs, or giving work back up its own
// chain, a new task is a proposal for the owner instead of starting.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createLog } from "../log.ts";
import { authorizedChildHandoff, authorizedExistingHandoff, proposalReason } from "./task-work.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

/** The task the scripted agent hands to `handTo` when asked to pass it on. */
let handing = { task: "", to: "" };
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({
    llm: scriptedLlm((_req, { said, afterTool }) =>
      said.includes("pass it on") && !afterTool
        ? callTool("h1", "task_update", { task: handing.task, assignee: handing.to })
        : say("ok"),
    ),
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

function task(title: string, by: string, parent?: string) {
  const store = env.core.store;
  return store.tasks.create({
    title,
    status: "todo",
    parent_id: parent,
    thread_id: store.threads.create({ kind: "task", title, agent_ids: ["superagent"] }).id,
    by,
  });
}

test("a short chain hands on freely; too deep, or back up the chain, waits for the owner", () => {
  const store = env.core.store;
  const audit = task("SEO audit", "owner");
  assert.equal(proposalReason(store, audit.id, "vera", "scout"), undefined, "the audit's findings go to marketing");
  const copy = task("Rewrite the landing copy", "scout", audit.id);
  assert.match(proposalReason(store, copy.id, "scout", "vera") ?? "", /gives work back up its own chain/);
  const check = task("Check the new copy", "vera", copy.id);
  assert.match(proposalReason(store, check.id, "omar", "nora") ?? "", /4 hand-offs deep/);
  assert.equal(proposalReason(store, copy.id, "vera", "vera"), undefined, "its own next step is not a hand-off back");
});

test("handing a task to another agent follows the same rule: back up its chain, it waits for the owner", async () => {
  const store = env.core.store;
  const launch = task("Plan the launch", "superagent");
  const sub = store.tasks.create({
    title: "Draft the launch post",
    description: "Two paragraphs for the blog.",
    status: "todo",
    parent_id: launch.id,
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Draft the launch post", agent_ids: ["vera"] }).id,
    by: "superagent",
  });
  handing = { task: sub.id, to: "superagent" };
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "vera", title: "Vera" });
  await env.client.call("threads.send", { thread: chat.id, text: "pass it on" });
  await env.settle(chat.id);
  const after = store.tasks.get(sub.id);
  assert.equal(after?.assignee, "superagent");
  assert.equal(after?.proposed, true, "the owner decides before it goes back up");
  assert.deepEqual(store.threads.byTask(sub.id), [], "no work started on it");
  const step = store.runs
    .list(chat.id, 5)
    .flatMap((r) => store.runs.steps(r.id))
    .find((x) => x.tool === "task_update");
  assert.match(step?.result ?? "", /^proposed /, "the agent is told it waits for the owner");
  const tray = await env.client.call("notifications.list", {});
  assert.ok(
    tray.notifications.some((n) => n.ref?.startsWith("proposals:")),
    "the owner is told of the proposal",
  );
});

test("a short active handoff does not inherit historical parent depth", async () => {
  const store = env.core.store;
  const a = task("Historic root", "owner");
  const b = task("Historic child", "superagent", a.id);
  const c = task("Historic grandchild", "superagent", b.id);
  const current = store.tasks.create({
    title: "Owner-authorized current work",
    description: "Review the delivered work.",
    status: "doing",
    parent_id: c.id,
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Current work", agent_ids: ["vera"] }).id,
    by: "owner",
  });
  handing = { task: current.id, to: "scout" };
  const chat = store.threads.create({
    kind: "loose",
    agent_ids: ["vera"],
    task_id: current.id,
    title: "Fresh owner request",
  });
  await env.client.call("threads.send", { thread: chat.id, text: "pass it on" });
  await env.settle(chat.id);
  assert.notEqual(store.tasks.get(current.id)?.proposed, true, "old task parents are not active handoffs");
  const sessions = store.threads.byTask(current.id).filter((t) => t.agent_ids[0] === "scout");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.agent_ids[0], "scout");
  await env.settle(sessions[0]?.id ?? "");
  const starts = store.runs.list(sessions[0]?.id ?? "").filter((r) => r.trigger === "a2a");
  assert.equal(starts.length, 1);
  assert.equal(starts[0]?.state, "completed");
});

test("an owner authorization is scoped to its task session and remains bounded", () => {
  const store = env.core.store;
  const root = task("Old parent", "owner");
  const record = store.tasks.create({
    title: "Owner-authorized task",
    description: "Work on this task.",
    status: "doing",
    parent_id: root.id,
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Work", agent_ids: ["vera"] }).id,
    by: "owner",
  });
  const newRun = (agent: string, taskId?: string) => {
    const thread = store.threads.create({
      kind: "loose",
      title: "Executor",
      agent_ids: [agent],
      ...(taskId ? { task_id: taskId } : {}),
    });
    const run = store.runs.create({
      thread_id: thread.id,
      agent_id: agent,
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Work" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    return { id: agent, thread_id: thread.id, run_id: run.id };
  };
  const source = newRun("vera", record.id);
  assert.equal(authorizedExistingHandoff(store, record, source), "allowed");
  store.tasks.change(record.id, { assignee: "vera" }, "vera");
  store.tasks.change(record.id, { assignee: "vera" }, "vera");
  store.tasks.change(record.id, { assignee: "vera" }, "vera");
  assert.equal(authorizedExistingHandoff(store, record, source), "allowed", "no-op assignments are not transfers");
  assert.equal(
    authorizedExistingHandoff(store, record, newRun("vera")),
    undefined,
    "an unrelated chat has no exemption",
  );
  assert.equal(
    authorizedExistingHandoff(store, record, newRun("scout", record.id)),
    undefined,
    "only the assignee may transfer",
  );
  store.tasks.change(record.id, { assignee: "scout" }, "vera");
  store.tasks.change(record.id, { assignee: "superagent" }, "scout");
  const current = store.tasks.change(record.id, { assignee: "vera" }, "superagent");
  assert.ok(current);
  assert.equal(
    authorizedExistingHandoff(store, current, newRun("vera", record.id)),
    "limit",
    "three transfers cannot loop forever",
  );
  store.tasks.change(record.id, { assignee: null }, "owner");
  const later = store.tasks.change(record.id, { assignee: "vera" }, "superagent");
  assert.ok(later);
  assert.equal(
    authorizedExistingHandoff(store, later, newRun("vera", record.id)),
    "denied",
    "owner unassignment revokes the anchor",
  );
});

test("an explicitly proposed deep task still cannot be started by an agent", async () => {
  const store = env.core.store;
  const a = task("Historic proposal root", "owner");
  const b = task("Historic proposal child", "superagent", a.id);
  const c = task("Historic proposal grandchild", "superagent", b.id);
  const current = store.tasks.create({
    title: "Explicit proposal",
    description: "Review only if accepted.",
    status: "doing",
    parent_id: c.id,
    assignee: "vera",
    proposed: true,
    thread_id: store.threads.create({ kind: "task", title: "Proposal", agent_ids: ["vera"] }).id,
    by: "owner",
  });
  handing = { task: current.id, to: "scout" };
  const chat = store.threads.create({ kind: "loose", agent_ids: ["vera"], task_id: current.id, title: "Attempt" });
  await env.client.call("threads.send", { thread: chat.id, text: "pass it on" });
  await env.settle(chat.id);
  assert.equal(store.tasks.get(current.id)?.proposed, true);
  assert.equal(store.threads.byTask(current.id).filter((t) => t.agent_ids[0] === "scout").length, 0);
});

test("a fourth transfer of an owner-authorized task is still proposed", async () => {
  const store = env.core.store;
  const root = task("Bounded root", "owner");
  const current = store.tasks.create({
    title: "Bounded work",
    description: "Carry out bounded work.",
    status: "doing",
    parent_id: root.id,
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Bounded work", agent_ids: ["vera"] }).id,
    by: "owner",
  });
  store.tasks.change(current.id, { assignee: "scout" }, "vera");
  store.tasks.change(current.id, { assignee: "superagent" }, "scout");
  store.tasks.change(current.id, { assignee: "vera" }, "superagent");
  handing = { task: current.id, to: "scout" };
  const chat = store.threads.create({
    kind: "loose",
    title: "Existing work",
    agent_ids: ["vera"],
    task_id: current.id,
  });
  await env.client.call("threads.send", { thread: chat.id, text: "pass it on" });
  await env.settle(chat.id);
  assert.equal(store.tasks.get(current.id)?.proposed, true);
  assert.equal(store.threads.byTask(current.id).filter((t) => t.agent_ids[0] === "scout").length, 0);
});

test("an unrelated conversation cannot use an owner-authorized task's exemption", async () => {
  const store = env.core.store;
  const a = task("Old root", "owner");
  const b = task("Old child", "superagent", a.id);
  const c = task("Old grandchild", "superagent", b.id);
  const current = store.tasks.create({
    title: "Work from another chat",
    description: "Only the actual task executor may hand this on.",
    status: "doing",
    parent_id: c.id,
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Work", agent_ids: ["vera"] }).id,
    by: "owner",
  });
  handing = { task: current.id, to: "scout" };
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "vera", title: "Unrelated" });
  await env.client.call("threads.send", { thread: chat.id, text: "pass it on" });
  await env.settle(chat.id);
  assert.equal(store.tasks.get(current.id)?.proposed, true);
  assert.equal(store.threads.byTask(current.id).length, 0);
});

test("an owner-origin task-result continuation can start a child despite older task parents", async () => {
  const store = env.core.store;
  const a = task("Old root for child", "owner");
  const b = task("Old child for child", "superagent", a.id);
  const c = task("Old grandchild for child", "scout", b.id);
  const parent = store.tasks.create({
    title: "Current parent",
    description: "Coordinate current approved work.",
    status: "doing",
    parent_id: c.id,
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Current parent", agent_ids: ["vera"] }).id,
    by: "superagent",
  });
  const root = store.threads.create({ kind: "loose", title: "Owner request", agent_ids: ["vera"] });
  const rootRun = store.runs.create({
    thread_id: root.id,
    agent_id: "vera",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Coordinate work" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const work = store.threads.create({ kind: "loose", title: "Parent work", agent_ids: ["vera"], task_id: parent.id });
  const source = store.runs.create({
    thread_id: work.id,
    agent_id: "vera",
    trigger: "a2a",
    depth: 1,
    input: {
      origin: { kind: "agent", id: "vera", name: "Vera", thread_id: root.id, run_id: rootRun.id },
      text: "Work",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const returned = store.tasks.create({
    title: "Prior child",
    description: "Already finished.",
    status: "doing",
    parent_id: parent.id,
    assignee: "scout",
    thread_id: store.threads.create({ kind: "task", title: "Prior child", agent_ids: ["scout"] }).id,
    by: "vera",
    from: { thread: work.id, run: source.id },
  });
  store.tasks.change(returned.id, { state: "done" }, "scout");
  const result = store.runs.create({
    thread_id: work.id,
    agent_id: "vera",
    trigger: "a2a_result",
    depth: 1,
    input: {
      origin: {
        kind: "task_result",
        task_id: returned.id,
        title: returned.title,
        state: "done",
        agent_id: "scout",
        name: "Scout",
      },
      text: "Prior child finished",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const response = await env.core.dispatch(
    "tasks.create",
    { title: "Next child", description: "Perform the next bounded task.", assignee: "scout" },
    {
      transport: "internal",
      role: "operator",
      actor: "agent",
      session: undefined,
      log: createLog("test", true),
      agent: { id: "vera", thread_id: work.id, run_id: result.id },
    },
    "child-test",
  );
  assert.equal(response.ok, true);
  const child = store.tasks.list({ parent: parent.id, limit: 10 }).find((t) => t.title === "Next child");
  assert.ok(child);
  assert.notEqual(child.proposed, true, "the past task tree is not the active chain");
  assert.equal(store.threads.byTask(child.id).filter((t) => t.agent_ids[0] === "scout").length, 1);
  const proposed = await env.core.dispatch(
    "tasks.create",
    { title: "Explicit child proposal", description: "Wait for owner.", assignee: "scout", propose: true },
    {
      transport: "internal",
      role: "operator",
      actor: "agent",
      session: undefined,
      log: createLog("test", true),
      agent: { id: "vera", thread_id: work.id, run_id: result.id },
    },
    "explicit-child-test",
  );
  assert.equal(proposed.ok, true);
  const draft = store.tasks.list({ parent: parent.id, limit: 10 }).find((t) => t.title === "Explicit child proposal");
  assert.equal(draft?.proposed, true);
  assert.equal(store.threads.byTask(draft?.id ?? "").length, 0);
});

test("child handoffs trust only a bounded verified owner-origin execution chain", () => {
  const store = env.core.store;
  const parent = store.tasks.create({
    title: "Current parent for origin checks",
    description: "Authorized.",
    status: "doing",
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Parent", agent_ids: ["vera"] }).id,
    by: "owner",
  });
  const work = store.threads.create({ kind: "loose", title: "Parent work", agent_ids: ["vera"], task_id: parent.id });
  const rootThread = store.threads.create({ kind: "loose", title: "Owner root", agent_ids: ["scout"] });
  const root = store.runs.create({
    thread_id: rootThread.id,
    agent_id: "scout",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Do this" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const next = (thread_id: string, agent_id: string, previous: typeof root) =>
    store.runs.create({
      thread_id,
      agent_id,
      trigger: "a2a",
      input: {
        origin: {
          kind: "agent",
          id: previous.agent_id,
          name: previous.agent_id,
          thread_id: previous.thread_id,
          run_id: previous.id,
        },
        text: "Do work",
      },
      deadline_at: "2099-01-01T00:00:00Z",
    });
  const current = next(work.id, "vera", root);
  const ctx = { id: "vera", thread_id: work.id, run_id: current.id };
  assert.equal(authorizedChildHandoff(store, parent, ctx, "superagent"), "allowed");
  assert.equal(
    authorizedChildHandoff(store, parent, ctx, "scout"),
    "backflow",
    "the active sender cannot get its work back",
  );
  store.threads.mergeContext(rootThread.id, { client: "outside-app" });
  assert.equal(
    authorizedChildHandoff(store, parent, ctx, "superagent"),
    undefined,
    "outside apps do not become owner authorization",
  );
  store.threads.mergeContext(rootThread.id, { client: undefined });
  const mid1 = store.threads.create({ kind: "loose", title: "First", agent_ids: ["vera"] });
  const mid2 = store.threads.create({ kind: "loose", title: "Second", agent_ids: ["superagent"] });
  const run1 = next(mid1.id, "vera", root);
  const run2 = next(mid2.id, "superagent", run1);
  const run3 = next(work.id, "vera", run2);
  assert.equal(
    authorizedChildHandoff(store, parent, { ...ctx, run_id: run3.id }, "superagent"),
    "limit",
    "three active hops require owner decision",
  );
  const wrong = store.threads.create({ kind: "loose", title: "Other", agent_ids: ["vera"] });
  assert.equal(authorizedChildHandoff(store, parent, { ...ctx, thread_id: wrong.id }, "superagent"), undefined);
  store.tasks.change(parent.id, { assignee: null }, "owner");
  store.tasks.change(parent.id, { assignee: "vera" }, "scout");
  assert.equal(
    authorizedChildHandoff(store, store.tasks.get(parent.id), ctx, "superagent"),
    undefined,
    "an owner revocation cannot be bypassed by the creator's run origin",
  );
  store.tasks.change(parent.id, { proposed: true }, "owner");
  assert.equal(
    authorizedChildHandoff(store, store.tasks.get(parent.id), ctx, "superagent"),
    undefined,
    "proposed parent gives no implicit approval",
  );
});

test("a forged task-result link does not grant a child-handoff exemption", () => {
  const store = env.core.store;
  const parent = store.tasks.create({
    title: "Parent result",
    description: "Work",
    status: "doing",
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Parent", agent_ids: ["vera"] }).id,
    by: "owner",
  });
  const work = store.threads.create({ kind: "loose", title: "Work", agent_ids: ["vera"], task_id: parent.id });
  const other = store.tasks.create({
    title: "Other task",
    description: "Elsewhere",
    status: "doing",
    thread_id: store.threads.create({ kind: "task", title: "Other", agent_ids: ["scout"] }).id,
    by: "scout",
  });
  store.tasks.change(other.id, { state: "done" }, "scout");
  const r = store.runs.create({
    thread_id: work.id,
    agent_id: "vera",
    trigger: "a2a_result",
    input: {
      origin: {
        kind: "task_result",
        task_id: other.id,
        title: other.title,
        state: "done",
        agent_id: "scout",
        name: "Scout",
      },
      text: "Done",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  assert.equal(
    authorizedChildHandoff(store, parent, { id: "vera", thread_id: work.id, run_id: r.id }, "scout"),
    undefined,
  );
});

test("an owner-requested task turn can hand on agent-created work without inheriting old parent depth", async () => {
  const store = env.core.store;
  const a = task("Old owner root for a task", "owner");
  const b = task("Old planning child", "superagent", a.id);
  const c = task("Old planning grandchild", "superagent", b.id);
  const current = store.tasks.create({
    title: "Owner-requested existing task",
    description: "Review the delivered work.",
    status: "doing",
    parent_id: c.id,
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Current work", agent_ids: ["vera"] }).id,
    by: "superagent",
  });
  handing = { task: current.id, to: "scout" };
  const chat = store.threads.create({
    kind: "loose",
    agent_ids: ["vera"],
    task_id: current.id,
    title: "Owner request",
  });
  await env.client.call("threads.send", { thread: chat.id, text: "pass it on" });
  await env.settle(chat.id);
  assert.notEqual(store.tasks.get(current.id)?.proposed, true);
  assert.equal(store.threads.byTask(current.id).filter((t) => t.agent_ids[0] === "scout").length, 1);
});

test("an owner-revoked task cannot use a new run-origin to regain authorization", async () => {
  const store = env.core.store;
  const current = store.tasks.create({
    title: "Revoked work",
    description: "Scope revoked",
    status: "doing",
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Revoked work", agent_ids: ["vera"] }).id,
    by: "owner",
  });
  store.tasks.change(current.id, { assignee: null }, "owner");
  store.tasks.change(current.id, { assignee: "vera" }, "superagent");
  handing = { task: current.id, to: "scout" };
  const chat = store.threads.create({
    kind: "loose",
    title: "New owner-origin run",
    agent_ids: ["vera"],
    task_id: current.id,
  });
  await env.client.call("threads.send", { thread: chat.id, text: "pass it on" });
  await env.settle(chat.id);
  assert.equal(store.tasks.get(current.id)?.proposed, true);
  assert.equal(store.threads.byTask(current.id).filter((t) => t.agent_ids[0] === "scout").length, 0);
});

test("a task continuation preserves verified authorization without inventing provenance for old runs", () => {
  const store = env.core.store;
  const parent = store.tasks.create({
    title: "Continuing task",
    description: "Continue the work.",
    status: "doing",
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Continuing task", agent_ids: ["vera"] }).id,
    by: "superagent",
  });
  const chat = store.threads.create({ kind: "loose", title: "Work", agent_ids: ["vera"], task_id: parent.id });
  const original = store.runs.create({
    thread_id: chat.id,
    agent_id: "vera",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Start work." },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  store.runs.setState(original, "completed");
  const continued = store.runs.create({
    thread_id: chat.id,
    agent_id: "vera",
    trigger: "system",
    input: {
      origin: { kind: "task_continue", task_id: parent.id, title: parent.title, part: 2, of: 9, from_run: original.id },
      text: "Continue.",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const context = { id: "vera", thread_id: chat.id, run_id: continued.id };
  assert.equal(authorizedChildHandoff(store, parent, context, "scout"), "allowed");
  const old = store.runs.create({
    thread_id: chat.id,
    agent_id: "vera",
    trigger: "system",
    input: {
      origin: { kind: "task_continue", task_id: parent.id, title: parent.title, part: 2, of: 9 },
      text: "Continue.",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  assert.equal(authorizedChildHandoff(store, parent, { ...context, run_id: old.id }, "scout"), undefined);
  for (const origin of [
    { kind: "task_continue" as const, task_id: "wrong", title: parent.title, part: 2, of: 9, from_run: original.id },
    { kind: "task_continue" as const, task_id: parent.id, title: parent.title, part: 2, of: 9, from_run: "missing" },
    { kind: "stalled_task" as const, task_id: "wrong", title: parent.title, from_run: original.id },
  ]) {
    const forged = store.runs.create({
      thread_id: chat.id,
      agent_id: "vera",
      trigger: "system",
      input: { origin, text: "Continue." },
      deadline_at: "2099-01-01T00:00:00Z",
    });
    assert.equal(authorizedChildHandoff(store, parent, { ...context, run_id: forged.id }, "scout"), undefined);
  }
  const revived = store.runs.create({
    thread_id: chat.id,
    agent_id: "vera",
    trigger: "system",
    input: {
      origin: { kind: "stalled_task", task_id: parent.id, title: parent.title, from_run: original.id },
      text: "Continue.",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  assert.equal(authorizedChildHandoff(store, parent, { ...context, run_id: revived.id }, "scout"), "allowed");
});

test("a recorded owner routine can authorize a bounded task handoff, but an unrecorded one cannot", () => {
  const store = env.core.store;
  const routine = store.routines.create({
    name: "Owner schedule",
    agent_id: "superagent",
    schedule: { kind: "manual" },
    action: "agent",
    prompt: "Coordinate work",
    call_model: "always",
    enabled: true,
    next_run_at: undefined,
  });
  const rootThread = store.threads.create({ kind: "routine", title: "Scheduled", agent_ids: ["superagent"] });
  const root = store.runs.create({
    thread_id: rootThread.id,
    agent_id: "superagent",
    trigger: "routine",
    input: { origin: { kind: "routine", id: routine.id, name: routine.name }, text: "Coordinate work" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const parent = store.tasks.create({
    title: "Scheduled work",
    description: "Execute scheduled work",
    status: "doing",
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Scheduled work", agent_ids: ["vera"] }).id,
    by: "superagent",
  });
  const chat = store.threads.create({ kind: "loose", title: "Work", agent_ids: ["vera"], task_id: parent.id });
  const run = store.runs.create({
    thread_id: chat.id,
    agent_id: "vera",
    trigger: "a2a",
    input: {
      origin: { kind: "agent", id: "superagent", name: "Orchestrator", thread_id: rootThread.id, run_id: root.id },
      text: "Do work",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const context = { id: "vera", thread_id: chat.id, run_id: run.id };
  assert.equal(authorizedChildHandoff(store, parent, context, "scout"), undefined);
  store.routines.addRun({ routine_id: routine.id, run_id: root.id, thread_id: rootThread.id });
  assert.equal(authorizedChildHandoff(store, parent, context, "scout"), "allowed");
  assert.equal(authorizedChildHandoff(store, parent, context, "superagent"), "backflow");
});

test("a verified delegation result continues its caller's authority without trusting an unrelated result", () => {
  const store = env.core.store;
  const parent = store.tasks.create({
    title: "Coordinate",
    description: "Coordinate the work",
    status: "doing",
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Coordinate", agent_ids: ["vera"] }).id,
    by: "superagent",
  });
  const chat = store.threads.create({ kind: "loose", title: "Work", agent_ids: ["vera"], task_id: parent.id });
  const original = store.runs.create({
    thread_id: chat.id,
    agent_id: "vera",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Start" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const helperChat = store.threads.create({
    kind: "loose",
    title: "Consult",
    agent_ids: ["scout"],
    parent_id: chat.id,
  });
  const helper = store.runs.create({
    thread_id: helperChat.id,
    agent_id: "scout",
    trigger: "a2a",
    parent_run_id: original.id,
    input: {
      origin: { kind: "agent", id: "vera", name: "Vera", thread_id: chat.id, run_id: original.id },
      text: "Consult",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  store.runs.setState(helper, "completed");
  const resumed = store.runs.create({
    thread_id: chat.id,
    agent_id: "vera",
    trigger: "a2a_result",
    input: {
      origin: {
        kind: "delegation_result",
        agent_id: "scout",
        name: "Scout",
        thread_id: helperChat.id,
        run_id: helper.id,
        state: "completed",
      },
      text: "Result",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const ctx = { id: "vera", thread_id: chat.id, run_id: resumed.id };
  assert.equal(authorizedChildHandoff(store, parent, ctx, "omar"), "allowed");
  const forged = store.runs.create({
    thread_id: chat.id,
    agent_id: "vera",
    trigger: "a2a_result",
    input: {
      origin: {
        kind: "delegation_result",
        agent_id: "impostor",
        name: "Scout",
        thread_id: helperChat.id,
        run_id: helper.id,
        state: "completed",
      },
      text: "Result",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  assert.equal(authorizedChildHandoff(store, parent, { ...ctx, run_id: forged.id }, "omar"), undefined);
});

test("an answered input continues verified prior authority, never a pending or unrelated input", () => {
  const store = env.core.store;
  const parent = store.tasks.create({
    title: "Waiting work",
    description: "Resume work",
    status: "doing",
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Waiting work", agent_ids: ["vera"] }).id,
    by: "superagent",
  });
  const chat = store.threads.create({ kind: "loose", title: "Work", agent_ids: ["vera"], task_id: parent.id });
  const original = store.runs.create({
    thread_id: chat.id,
    agent_id: "vera",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Start" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const input = store.inputs.create({
    run_id: original.id,
    thread_id: chat.id,
    agent_id: "vera",
    call_id: "question",
    kind: "question",
    prompt: "Which?",
    waitMs: 60000,
  });
  store.runs.setState(original, "completed");
  const wake = () =>
    store.runs.create({
      thread_id: chat.id,
      agent_id: "vera",
      trigger: "user",
      input: { origin: { kind: "input_answer", input_id: input.id }, text: "Answer" },
      deadline_at: "2099-01-01T00:00:00Z",
    });
  const pending = wake();
  const context = { id: "vera", thread_id: chat.id, run_id: pending.id };
  assert.equal(authorizedChildHandoff(store, parent, context, "scout"), undefined);
  store.inputs.settle(input.id, "answered", "Continue");
  const answered = wake();
  assert.equal(authorizedChildHandoff(store, parent, { ...context, run_id: answered.id }, "scout"), "allowed");
});

test("an unrelated agent cannot inherit an owner-authorized task by reassigning it", () => {
  const store = env.core.store;
  const task = store.tasks.create({
    title: "Assigned work",
    description: "Only Vera may pass this work on",
    status: "doing",
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Assigned work", agent_ids: ["vera"] }).id,
    by: "owner",
  });
  const reassigned = store.tasks.change(task.id, { assignee: "scout" }, "superagent");
  assert.ok(reassigned);
  const chat = store.threads.create({ kind: "loose", title: "Scout", agent_ids: ["scout"], task_id: task.id });
  const run = store.runs.create({
    thread_id: chat.id,
    agent_id: "scout",
    trigger: "a2a",
    input: {
      origin: { kind: "agent", id: "superagent", name: "Super", thread_id: chat.id, run_id: "other" },
      text: "Work",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  assert.equal(
    authorizedExistingHandoff(store, reassigned, { id: "scout", thread_id: chat.id, run_id: run.id }),
    "denied",
  );
});

test("a project orchestrator can hand on its own old task from an owner-requested project chat", async () => {
  const store = env.core.store;
  const project = "example-project";
  store.projects.upsert({ id: project, name: "Example" });
  store.agents.upsertApc({
    id: "example-lead",
    name: "Lead",
    project_id: project,
    slug: "lead",
    role: "Lead",
    prompt: "",
    extra: { orchestrator: true },
  });
  store.agents.upsertApc({
    id: "example-worker",
    name: "Worker",
    project_id: project,
    parent: "example-lead",
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
      thread_id: store.threads.create({ kind: "task", title, project_id: project, agent_ids: ["example-lead"] }).id,
      by: "example-worker",
    });
  const a = old("Old root"),
    b = old("Old phase", a.id),
    c = old("Old work", b.id);
  const current = store.tasks.create({
    title: "Ready product work",
    description: "Complete a bounded change.",
    status: "doing",
    project_id: project,
    parent_id: c.id,
    assignee: "example-lead",
    thread_id: store.threads.create({
      kind: "task",
      title: "Ready product work",
      project_id: project,
      agent_ids: ["example-lead"],
    }).id,
    by: "example-worker",
  });
  handing = { task: current.id, to: "example-worker" };
  const chat = await env.client.call("threads.create", {
    kind: "loose",
    agent_id: "example-lead",
    project_id: project,
    title: "Project coordination",
  });
  await env.client.call("threads.send", { thread: chat.id, text: "pass it on" });
  await env.settle(chat.id);
  const result = store.tasks.get(current.id);
  assert.notEqual(result?.proposed, true);
  const sessions = store.threads.byTask(current.id).filter((t) => t.agent_ids[0] === "example-worker");
  assert.equal(sessions.length, 1);
  await env.settle(sessions[0]?.id ?? "");
  assert.ok(
    store.runs.list(sessions[0]?.id ?? "").some((r) => r.agent_id === "example-worker" && r.state === "completed"),
  );
});

test("coordinator chat authority requires a verified owner chain, project scope and current assignment", () => {
  const store = env.core.store;
  const project = "secure-example";
  store.projects.upsert({ id: project, name: "Secure example" });
  store.agents.upsertApc({
    id: "secure-lead",
    name: "Lead",
    project_id: project,
    slug: "lead",
    role: "Lead",
    prompt: "",
    extra: { orchestrator: true },
  });
  store.agents.upsertApc({
    id: "secure-worker",
    name: "Worker",
    project_id: project,
    parent: "secure-lead",
    slug: "worker",
    role: "Worker",
    prompt: "",
    extra: {},
  });
  const task = store.tasks.create({
    title: "Owner-scope work",
    description: "Work safely",
    status: "doing",
    project_id: project,
    assignee: "secure-lead",
    thread_id: store.threads.create({ kind: "task", title: "Task", project_id: project, agent_ids: ["secure-lead"] })
      .id,
    by: "secure-worker",
  });
  const chat = store.threads.create({
    kind: "agent",
    title: "Coordination",
    project_id: project,
    agent_ids: ["secure-lead"],
  });
  const original = store.runs.create({
    thread_id: chat.id,
    agent_id: "secure-lead",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Coordinate" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const helperChat = store.threads.create({
    kind: "a2a",
    title: "Audit",
    project_id: project,
    agent_ids: ["secure-lead"],
    parent_id: chat.id,
  });
  const helper = store.runs.create({
    thread_id: helperChat.id,
    agent_id: "secure-lead",
    trigger: "a2a",
    parent_run_id: original.id,
    input: {
      origin: { kind: "agent", id: "secure-lead", name: "Lead", thread_id: chat.id, run_id: original.id },
      text: "Audit",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  store.runs.setState(helper, "completed");
  const resumed = store.runs.create({
    thread_id: chat.id,
    agent_id: "secure-lead",
    trigger: "a2a_result",
    input: {
      origin: {
        kind: "delegation_result",
        agent_id: "secure-lead",
        name: "Audit",
        thread_id: helperChat.id,
        run_id: helper.id,
        state: "completed",
      },
      text: "Result",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const ctx = { id: "secure-lead", thread_id: chat.id, run_id: resumed.id };
  const options = { allowCoordinatorChat: true };
  assert.equal(authorizedChildHandoff(store, task, ctx, "secure-worker", options), "allowed");
  assert.equal(
    authorizedChildHandoff(store, task, ctx, "secure-worker"),
    undefined,
    "not a general child-task exemption",
  );
  store.threads.mergeContext(chat.id, { client: "external-app" });
  assert.equal(
    authorizedChildHandoff(store, task, ctx, "secure-worker", options),
    undefined,
    "external clients are not the owner",
  );
  store.threads.mergeContext(chat.id, { client: undefined });
  const foreign = store.threads.create({ kind: "agent", title: "Wrong project", agent_ids: ["secure-lead"] });
  const foreignRun = store.runs.create({
    thread_id: foreign.id,
    agent_id: "secure-lead",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Coordinate" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  assert.equal(
    authorizedChildHandoff(
      store,
      task,
      { ...ctx, thread_id: foreign.id, run_id: foreignRun.id },
      "secure-worker",
      options,
    ),
    undefined,
    "no project scope",
  );
  const workerTask = store.tasks.create({
    title: "Worker task",
    description: "Work safely",
    status: "doing",
    project_id: project,
    assignee: "secure-worker",
    thread_id: store.threads.create({ kind: "task", title: "Task", project_id: project, agent_ids: ["secure-worker"] })
      .id,
    by: "secure-lead",
  });
  assert.equal(
    authorizedChildHandoff(store, workerTask, ctx, "secure-lead", options),
    undefined,
    "cannot take work assigned to someone else",
  );
  const revokedUnassigned = store.tasks.change(workerTask.id, { assignee: null }, "owner");
  assert.equal(
    authorizedChildHandoff(store, revokedUnassigned, ctx, "secure-lead", options),
    undefined,
    "cannot override owner unassignment",
  );
  const workerChat = store.threads.create({
    kind: "agent",
    title: "Worker",
    project_id: project,
    agent_ids: ["secure-worker"],
  });
  const workerRun = store.runs.create({
    thread_id: workerChat.id,
    agent_id: "secure-worker",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Coordinate" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  assert.equal(
    authorizedChildHandoff(
      store,
      workerTask,
      { id: "secure-worker", thread_id: workerChat.id, run_id: workerRun.id },
      "secure-lead",
      options,
    ),
    undefined,
    "worker is not the project orchestrator",
  );
  store.tasks.change(task.id, { assignee: null }, "owner");
  const reassigned = store.tasks.change(task.id, { assignee: "secure-lead" }, "secure-worker");
  assert.equal(
    authorizedChildHandoff(store, reassigned, ctx, "secure-worker", options),
    undefined,
    "revocation remains effective",
  );
});

test("a verified review return can reach its direct author without permitting ordinary backflow", () => {
  const store = env.core.store;
  const task = store.tasks.create({
    title: "Reviewed work",
    description: "Implement and review",
    status: "doing",
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Reviewed work", agent_ids: ["vera"] }).id,
    by: "superagent",
  });
  const rootChat = store.threads.create({ kind: "loose", title: "Owner", agent_ids: ["superagent"] });
  const root = store.runs.create({
    thread_id: rootChat.id,
    agent_id: "superagent",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Deliver work" },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const devChat = store.threads.create({
    kind: "loose",
    title: "Implementation",
    task_id: task.id,
    agent_ids: ["vera"],
  });
  const dev = store.runs.create({
    thread_id: devChat.id,
    agent_id: "vera",
    trigger: "a2a",
    input: {
      origin: { kind: "agent", id: "superagent", name: "Lead", thread_id: rootChat.id, run_id: root.id },
      text: "Implement",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const reviewed = store.tasks.change(task.id, { assignee: "scout", status: "review" }, "vera");
  assert.ok(reviewed);
  const qaChat = store.threads.create({ kind: "loose", title: "Review", task_id: task.id, agent_ids: ["scout"] });
  const qa = store.runs.create({
    thread_id: qaChat.id,
    agent_id: "scout",
    trigger: "a2a",
    input: {
      origin: { kind: "agent", id: "vera", name: "Vera", thread_id: devChat.id, run_id: dev.id },
      text: "Review",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  const context = { id: "scout", thread_id: qaChat.id, run_id: qa.id };
  assert.equal(authorizedChildHandoff(store, reviewed, context, "vera", { allowReviewReturn: true }), "allowed");
  assert.equal(authorizedChildHandoff(store, reviewed, context, "superagent", { allowReviewReturn: true }), "backflow");
  assert.equal(
    authorizedChildHandoff(store, { ...reviewed, status: "doing" }, context, "vera", { allowReviewReturn: true }),
    "backflow",
  );
  assert.equal(authorizedChildHandoff(store, reviewed, context, "vera"), "backflow");
  const returned = store.tasks.change(task.id, { assignee: "vera", status: "review" }, "scout");
  assert.ok(returned);
  const continued = store.runs.create({
    thread_id: devChat.id,
    agent_id: "vera",
    trigger: "a2a",
    input: {
      origin: { kind: "agent", id: "scout", name: "Scout", thread_id: qaChat.id, run_id: qa.id },
      text: "Review result",
    },
    deadline_at: "2099-01-01T00:00:00Z",
  });
  assert.equal(
    authorizedChildHandoff(store, returned, { id: "vera", thread_id: devChat.id, run_id: continued.id }, "scout", {
      allowReviewReturn: true,
    }),
    "allowed",
  );
});
