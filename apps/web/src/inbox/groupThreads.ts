import type { Project, Thread } from "@apx/protocol";
import { baseName, inInbox, inProject, isTopLevel, isWorking } from "../data/identity.ts";

/** `routines`: routine runs that told something are listed too. */
type Filter = { projectId?: string; query?: string; routines?: boolean };

/** A chat an agent delegated: it hangs under the chat it came from. */
const isDelegated = (t: Thread) => t.kind === "a2a" && !!t.parent_id && !t.archived;

const delegatedCache = new WeakMap<Record<string, Thread>, Map<string, Thread[]>>();

/** Each chat's delegated chats, newest first (one pass per threads snapshot, shared by every row). */
export function delegatedByChat(threads: Record<string, Thread>): Map<string, Thread[]> {
  const cached = delegatedCache.get(threads);
  if (cached) return cached;
  const out = new Map<string, Thread[]>();
  for (const t of Object.values(threads))
    if (isDelegated(t)) out.set(t.parent_id as string, [...(out.get(t.parent_id as string) ?? []), t]);
  for (const list of out.values()) list.sort(newest);
  delegatedCache.set(threads, out);
  return out;
}

/**
 * A delegated chat listed on its own: its caller is not loaded, or (in a project's list) the caller is outside that
 * project while the delegated chat works in it. Anywhere else it only shows under its caller.
 */
export function standsAlone(t: Thread, threads: Record<string, Thread>, projectId?: string): boolean {
  if (!isDelegated(t)) return false;
  const parent = threads[t.parent_id as string];
  if (!parent) return true;
  return !!projectId && inProject(t, projectId) && !inProject(parent, projectId);
}

/** Top-level chats the Inbox shows; a chat's delegated chats hang under it (`delegatedByChat`). */
function visible(
  threads: Record<string, Thread>,
  opts: Filter,
  keep: (t: Thread) => boolean = (t) => inInbox(t, !!opts.routines) || standsAlone(t, threads, opts.projectId),
): Thread[] {
  const q = opts.query?.trim().toLowerCase();
  return Object.values(threads).filter(
    (t) =>
      keep(t) &&
      (!opts.projectId || inProject(t, opts.projectId)) &&
      (!q || `${t.title} ${t.preview}`.toLowerCase().includes(q)),
  );
}

const newest = (a: Thread, b: Thread) => b.updated_at.localeCompare(a.updated_at);

/** Within a group: pinned chats first, then the most recent. */
export const pinnedFirst = (a: Thread, b: Thread) => Number(!!b.pinned) - Number(!!a.pinned) || newest(a, b);

/** Every chat a list shows: its rows and the delegated chats under them (what "Mark all as read" reads). */
export function listedThreads(threads: Record<string, Thread>, opts: Filter): Thread[] {
  const nested = delegatedByChat(threads);
  return visible(threads, opts).flatMap((t) => [t, ...(nested.get(t.id) ?? [])]);
}

/** The archived chats, most recent first: shown apart, under Archived. */
export function archivedThreads(threads: Record<string, Thread>, opts: Filter): Thread[] {
  return visible(threads, opts, (t) => !!t.archived && isTopLevel(t)).sort(newest);
}

export type ThreadGroup = {
  key: string;
  project: Project | undefined;
  name: string;
  threads: Thread[];
  running: number;
};

const NO_PROJECT = "__none__";

/** Inbox organisation "a" (by chat): top-level threads grouped by project, most recent group first. */
export function groupByProject(threads: Record<string, Thread>, projects: Project[], opts: Filter): ThreadGroup[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const groups = new Map<string, ThreadGroup>();
  for (const t of visible(threads, opts)) {
    const key = t.project_id ?? NO_PROJECT;
    let g = groups.get(key);
    if (!g) {
      const project = t.project_id ? byId.get(t.project_id) : undefined;
      g = { key, project, name: project?.name ?? baseName(), threads: [], running: 0 };
      groups.set(key, g);
    }
    g.threads.push(t);
    if (isWorking(t.state)) g.running++;
  }
  const out = [...groups.values()];
  const latest = (g: ThreadGroup) => g.threads.reduce((m, t) => (t.updated_at > m ? t.updated_at : m), "");
  out.sort((a, b) => latest(b).localeCompare(latest(a)));
  for (const g of out) g.threads.sort(pinnedFirst);
  return out;
}

/** A row of a chat list: a chat, or (`task`) every chat the agents keep for one task, together. */
export type ListEntry = { kind: "thread"; thread: Thread } | { kind: "task"; taskId: string; threads: Thread[] };

/** Chats agents keep for a task go together, where the task's most recent one would be; the rest stay as they are. */
export function bundleTasks(list: Thread[]): ListEntry[] {
  const out: ListEntry[] = [];
  const tasks = new Map<string, Extract<ListEntry, { kind: "task" }>>();
  for (const thread of list) {
    if (!thread.task_id) {
      out.push({ kind: "thread", thread });
      continue;
    }
    const bundle = tasks.get(thread.task_id);
    if (bundle) bundle.threads.push(thread);
    else {
      const entry = { kind: "task" as const, taskId: thread.task_id, threads: [thread] };
      tasks.set(thread.task_id, entry);
      out.push(entry);
    }
  }
  return out;
}

/**
 * One branch of the tree: an agent's chats, (`engine`) an engine's own sessions wherever they were started, or
 * (`task`) the chats of every agent working one task.
 */
export type AgentBranch = {
  agentId: string;
  engine?: string | undefined;
  task?: string | undefined;
  threads: Thread[];
};
export type ProjectTree = { key: string; project: Project | undefined; name: string; agents: AgentBranch[] };

/** Inbox organisation "b" (tree): project → agent (or task) → chats; busiest-recent first at every level. */
export function groupByAgent(threads: Record<string, Thread>, projects: Project[], opts: Filter): ProjectTree[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const trees = new Map<string, ProjectTree>();
  for (const t of visible(threads, opts).sort(newest)) {
    const key = t.project_id ?? NO_PROJECT;
    let tree = trees.get(key);
    if (!tree) {
      const project = t.project_id ? byId.get(t.project_id) : undefined;
      tree = { key, project, name: project?.name ?? baseName(), agents: [] };
      trees.set(key, tree);
    }
    // A Claude Code or Codex session belongs to that engine, and a task's chat to the task, not to the agent.
    const agentId = t.engine ? `engine:${t.engine}` : t.task_id ? `task:${t.task_id}` : (t.agent_ids[0] ?? "");
    let branch = tree.agents.find((a) => a.agentId === agentId);
    if (!branch) {
      branch = {
        agentId,
        ...(t.engine ? { engine: t.engine } : t.task_id ? { task: t.task_id } : {}),
        threads: [],
      };
      tree.agents.push(branch);
    }
    branch.threads.push(t);
  }
  // Branches keep their order (most recent first); a pinned chat goes to the top of its own branch.
  for (const tree of trees.values()) for (const b of tree.agents) b.threads.sort(pinnedFirst);
  return [...trees.values()];
}

export type TimeBucket = "pinned" | "running" | "today" | "yesterday" | "week" | "earlier";
export type ActivityGroup = { bucket: TimeBucket; threads: Thread[] };

/** Inbox organisation "c" (activity): pinned chats on top, then what runs now, then by when it last moved. */
export function groupByTime(threads: Record<string, Thread>, opts: Filter, now = new Date()): ActivityGroup[] {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const bucketOf = (t: Thread): TimeBucket => {
    if (t.pinned) return "pinned";
    if (isWorking(t.state) || t.state === "input-required") return "running";
    const at = Date.parse(t.updated_at);
    if (at >= day) return "today";
    if (at >= day - 86_400_000) return "yesterday";
    if (at >= day - 6 * 86_400_000) return "week";
    return "earlier";
  };
  const order: TimeBucket[] = ["pinned", "running", "today", "yesterday", "week", "earlier"];
  const groups = new Map<TimeBucket, Thread[]>();
  for (const t of visible(threads, opts).sort(newest)) groups.set(bucketOf(t), [...(groups.get(bucketOf(t)) ?? []), t]);
  return order.flatMap((bucket) => {
    const list = groups.get(bucket);
    return list ? [{ bucket, threads: list }] : [];
  });
}
