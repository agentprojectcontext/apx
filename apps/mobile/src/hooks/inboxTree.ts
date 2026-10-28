import { textOrder } from "../format.ts";
import type { Thread } from "./useWorkspace";

export type InboxNode = {
  key: string;
  kind: "thread" | "task" | "routine";
  ref: string;
  thread: Thread;
  children: InboxNode[];
};

const recent = (a: InboxNode, b: InboxNode) =>
  Number(Boolean(b.thread.pinned)) - Number(Boolean(a.thread.pinned)) ||
  textOrder(b.thread.updated_at, a.thread.updated_at) ||
  textOrder(a.key, b.key);

export type InboxFilter = {
  routines: boolean;
  project: string;
  /** Task chats (a task's work and the sessions under it); on unless turned off. */
  tasks?: boolean;
  /** Only chats one of these agents is in; empty or none: every agent. */
  agents?: readonly string[];
  /** The archived chats instead of the others. */
  archived?: boolean;
};

/** Project filtering precedes parenting: a session whose parent is unavailable stays reachable as a root. */
export function inboxTree(threads: Thread[], options: InboxFilter): InboxNode[] {
  const all = new Map(threads.map((thread) => [thread.id, thread]));
  const under = (thread: Thread, is: (item: Thread) => boolean): boolean => {
    const seen = new Set<string>();
    let current: Thread | undefined = thread;
    while (current && !seen.has(current.id)) {
      if (is(current)) return true;
      seen.add(current.id);
      current = all.get(current.parent_id ?? "");
    }
    return false;
  };
  const agents = options.agents?.length ? new Set(options.agents) : undefined;
  const nodes = new Map<string, InboxNode>();
  for (const thread of threads) {
    if (Boolean(thread.archived) !== Boolean(options.archived)) continue;
    if (!options.routines && under(thread, (item) => item.kind === "routine")) continue;
    if (options.tasks === false && under(thread, (item) => item.kind === "task" || Boolean(item.task_id))) continue;
    if (agents && !thread.agent_ids.some((id) => agents.has(id))) continue;
    if (
      options.project !== "all" &&
      (options.project === "default" ? !!thread.project_id : thread.project_id !== options.project)
    )
      continue;
    nodes.set(thread.id, { key: `thread:${thread.id}`, kind: "thread", ref: thread.id, thread, children: [] });
  }
  const roots: InboxNode[] = [];
  // Break cycles deterministically, without discarding any member of the malformed chain.
  const parents = new Map<string, string>();
  for (const node of [...nodes.values()].sort((a, b) => textOrder(a.key, b.key))) {
    const parent = node.thread.parent_id;
    if (!parent || !nodes.has(parent)) continue;
    let cursor: string | undefined = parent;
    const seen = new Set([node.ref]);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = parents.get(cursor);
    }
    if (!cursor) parents.set(node.ref, parent);
  }
  for (const node of nodes.values()) {
    const parent = nodes.get(parents.get(node.ref) ?? "");
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const bundles = new Map<string, InboxNode>();
  const result: InboxNode[] = [];
  for (const node of roots.sort(recent)) {
    const kind =
      node.thread.kind === "routine"
        ? node.thread.routine_id
          ? "routine"
          : undefined
        : node.thread.task_id
          ? "task"
          : undefined;
    const ref = kind === "routine" ? node.thread.routine_id : node.thread.task_id;
    if (!kind || !ref) {
      result.push(node);
      continue;
    }
    const key = `${kind}:${ref}`;
    let bundle = bundles.get(key);
    if (!bundle) {
      bundle = { key, kind, ref, thread: node.thread, children: [] };
      bundles.set(key, bundle);
      result.push(bundle);
    }
    bundle.children.push(node);
  }
  const sort = (list: InboxNode[]) => {
    list.sort(recent);
    for (const node of list) sort(node.children);
  };
  sort(result);
  return result;
}

export function nodeThreads(node: InboxNode): Thread[] {
  return [...(node.kind === "thread" ? [node.thread] : []), ...node.children.flatMap(nodeThreads)];
}

/** A matching descendant keeps its ancestors; a matching header keeps its entire subtree. */
export function searchInbox(
  nodes: InboxNode[],
  query: string | undefined,
  title: (node: InboxNode) => string,
): InboxNode[] {
  const words = query?.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? [];
  if (!words.length) return nodes;
  return nodes.flatMap((node) => {
    const hay =
      `${title(node)} ${node.kind === "thread" ? `${node.thread.title} ${node.thread.preview}` : ""}`.toLocaleLowerCase();
    if (words.every((word) => hay.includes(word))) return [node];
    const children = searchInbox(node.children, query, title);
    return children.length ? [{ ...node, children }] : [];
  });
}
