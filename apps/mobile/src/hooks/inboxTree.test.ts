import assert from "node:assert/strict";
import { test } from "node:test";
import { inboxTree, nodeThreads, searchInbox } from "./inboxTree.ts";
import type { Thread } from "./useWorkspace";

const thread = (id: string, patch: Partial<Thread> = {}): Thread => ({
  id,
  title: id,
  kind: "chat",
  preview: "",
  state: "completed",
  agent_ids: ["agent_a"],
  unread: 0,
  updated_at: "2026-10-19T10:00:00Z",
  ...patch,
});
const options = { routines: true, project: "all" };
const ids = (nodes: ReturnType<typeof inboxTree>) =>
  nodes
    .flatMap(nodeThreads)
    .map((item) => item.id)
    .sort();

test("routine identity groups cross-day executions but never same-title routines or legacy runs", () => {
  const nodes = inboxTree(
    [
      thread("one", { kind: "routine", routine_id: "r_one", title: "Daily · Today" }),
      thread("two", {
        kind: "routine",
        routine_id: "r_one",
        title: "Daily · Yesterday",
        updated_at: "2026-10-18T10:00:00Z",
      }),
      thread("other", { kind: "routine", routine_id: "r_two", title: "Daily · Today" }),
      thread("legacy_a", { kind: "routine", title: "Daily · Today" }),
      thread("legacy_b", { kind: "routine", title: "Daily · Yesterday" }),
    ],
    options,
  );
  assert.equal(nodes.length, 4);
  // The routine's row is its latest run; the runs before it nest under it.
  const routine = nodes.find((node) => node.ref === "r_one");
  assert.equal(routine?.thread.id, "one");
  assert.deepEqual(
    routine?.children.map((node) => node.ref),
    ["two"],
  );
  assert.equal(nodes.filter((node) => node.kind === "routine").length, 2);
  assert.equal(nodes.filter((node) => node.kind === "thread").length, 2);
});

test("task chats from multiple agents retain recursive delegations exactly once", () => {
  const nodes = inboxTree(
    [
      thread("chat", { task_id: "task", kind: "task" }),
      thread("review", { task_id: "task", kind: "task", agent_ids: ["agent_b"] }),
      thread("delegate", { kind: "a2a", parent_id: "chat", task_id: "task" }),
      thread("nested", { kind: "a2a", parent_id: "delegate" }),
    ],
    options,
  );
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]?.kind, "task");
  // The row is the task's latest chat: its own sessions and the task's other chats nest under it.
  assert.equal(nodes[0]?.thread.id, "chat");
  assert.deepEqual(nodes[0]?.children.map((node) => node.ref).sort(), ["delegate", "review"]);
  assert.equal(nodes[0]?.children.find((node) => node.ref === "delegate")?.children[0]?.ref, "nested");
  assert.deepEqual(ids(nodes), ["chat", "delegate", "nested", "review"]);
});

test("orphan and cross-project sessions remain reachable; archived parents do not swallow descendants", () => {
  const threads = [
    thread("parent", { project_id: "p_one" }),
    thread("cross", { kind: "a2a", parent_id: "parent", project_id: "p_two" }),
    thread("orphan", { kind: "a2a", parent_id: "missing", project_id: "p_two" }),
    thread("archived", { archived: true, project_id: "p_two" }),
    thread("survivor", { kind: "a2a", parent_id: "archived", project_id: "p_two" }),
  ];
  const nodes = inboxTree(threads, { ...options, project: "p_two" });
  assert.deepEqual(nodes.map((node) => node.ref).sort(), ["cross", "orphan", "survivor"]);
  assert.deepEqual(ids(inboxTree(threads, options)), ["cross", "orphan", "parent", "survivor"]);
});

test("cycles and self-parent links terminate with every visible thread exactly once", () => {
  const threads = [
    thread("a", { parent_id: "b" }),
    thread("b", { parent_id: "c" }),
    thread("c", { parent_id: "a" }),
    thread("self", { parent_id: "self" }),
  ];
  assert.deepEqual(ids(inboxTree(threads, options)), ["a", "b", "c", "self"]);
  assert.deepEqual(inboxTree(threads, options), inboxTree([...threads].reverse(), options));
});

test("routine toggle hides its descendants, not standalone sessions, including when ancestors are archived", () => {
  const threads = [
    thread("run", { kind: "routine", archived: true }),
    thread("child", { kind: "a2a", parent_id: "run" }),
    thread("orphan", { kind: "a2a", parent_id: "missing" }),
  ];
  assert.deepEqual(ids(inboxTree(threads, { ...options, routines: false })), ["orphan"]);
  assert.deepEqual(ids(inboxTree(threads, options)), ["child", "orphan"]);
});

test("search keeps matching descendants with ancestors, excludes siblings, and retains whole matching headers", () => {
  const nodes = inboxTree(
    [
      thread("root"),
      thread("match", { parent_id: "root", kind: "a2a", preview: "Unique result" }),
      thread("sibling", { parent_id: "root", kind: "a2a" }),
    ],
    options,
  );
  const title = (node: (typeof nodes)[number]) => node.thread.title;
  assert.deepEqual(ids(searchInbox(nodes, "unique result", title)), ["match", "root"]);
  assert.deepEqual(ids(searchInbox(nodes, "root", title)), ["match", "root", "sibling"]);
  assert.deepEqual(searchInbox(nodes, "absent", title), []);
  assert.equal(nodes[0]?.children.length, 2);
});

test("filters drop task chats with their sessions, keep only the picked agents, or list the archived ones", () => {
  const threads = [
    thread("chat"),
    thread("task", { task_id: "t1" }),
    thread("task_session", { parent_id: "task" }),
    thread("other_agent", { agent_ids: ["agent_b"] }),
    thread("old", { archived: true }),
  ];
  assert.deepEqual(ids(inboxTree(threads, { ...options, tasks: false })), ["chat", "other_agent"]);
  assert.deepEqual(ids(inboxTree(threads, { ...options, agents: ["agent_b"] })), ["other_agent"]);
  assert.deepEqual(ids(inboxTree(threads, { ...options, agents: [] })), [
    "chat",
    "other_agent",
    "task",
    "task_session",
  ]);
  assert.deepEqual(ids(inboxTree(threads, { ...options, archived: true })), ["old"]);
});

test("a task's row is its most recent chat, wherever its older chats were in the list", () => {
  const nodes = inboxTree(
    [
      thread("old_task_chat", { task_id: "t1", updated_at: "2026-10-17T10:00:00Z" }),
      thread("plain", { updated_at: "2026-10-18T10:00:00Z" }),
      thread("new_task_chat", { task_id: "t1", updated_at: "2026-10-19T10:00:00Z" }),
    ],
    options,
  );
  assert.deepEqual(
    nodes.map((node) => `${node.kind}:${node.thread.id}`),
    ["task:new_task_chat", "thread:plain"],
  );
  assert.deepEqual(
    nodes[0]?.children.map((node) => node.ref),
    ["old_task_chat"],
  );
  const title = (node: (typeof nodes)[number]) => node.thread.title;
  assert.deepEqual(ids(searchInbox(nodes, "new_task_chat", title)), ["new_task_chat", "old_task_chat"]);
});

test("a task's own chat joins its row once something was said in it, and stays off the list while empty", () => {
  const tasks = [
    { id: "t_started", thread_id: "board_started" },
    { id: "t_new", thread_id: "board_new" },
  ];
  const nodes = inboxTree(
    [
      thread("board_started", { kind: "task", preview: "On it.", updated_at: "2026-10-19T11:00:00Z" }),
      thread("helper", { task_id: "t_started" }),
      thread("board_new", { kind: "task", preview: "" }),
    ],
    options,
    tasks,
  );
  assert.deepEqual(
    nodes.map((node) => `${node.key}>${node.thread.id}`),
    ["task:t_started>board_started"],
  );
  assert.deepEqual(ids(nodes), ["board_started", "helper"]);
});

test("a hidden channel account's chats leave the list; grouping puts each account's chats under one row", () => {
  const on = (account: string, at: string) => ({ channel: { id: account, conversation: "c" }, updated_at: at });
  const threads = [
    thread("mail_a", { ...on("mail", "2026-10-19T09:00:00Z"), unread: 2 }),
    thread("mail_b", on("mail", "2026-10-19T11:00:00Z")),
    thread("wa_a", on("wa_sales", "2026-10-19T10:30:00Z")),
    thread("app_chat", { updated_at: "2026-10-19T10:00:00Z" }),
  ];
  assert.deepEqual(ids(inboxTree(threads, { ...options, hiddenChannels: ["mail"] })), ["app_chat", "wa_a"]);
  const grouped = inboxTree(threads, { ...options, byChannel: true });
  assert.deepEqual(
    grouped.map((node) => node.key),
    ["channel:mail", "channel:wa_sales", "thread:app_chat"],
  );
  const mail = grouped[0];
  assert.equal(mail?.thread.id, "mail_b");
  // Its newest chat heads it without being counted twice.
  assert.deepEqual(mail && nodeThreads(mail).map((item) => item.id), ["mail_b", "mail_a"]);
});
