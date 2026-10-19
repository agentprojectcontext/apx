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
  assert.deepEqual(
    nodes.find((node) => node.ref === "r_one")?.children.map((node) => node.ref),
    ["one", "two"],
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
  assert.equal(nodes[0]?.children.length, 2);
  assert.equal(nodes[0]?.children.find((node) => node.ref === "chat")?.children[0]?.children[0]?.ref, "nested");
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
