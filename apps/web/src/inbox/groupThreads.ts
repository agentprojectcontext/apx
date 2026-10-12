import type { Project, Thread } from "@apx/protocol";
import { baseName, inInbox, inProject, isTopLevel, isWorking } from "../data/identity.ts";

/** `routines`: routine runs that told something are listed too. */
type Filter = { projectId?: string; query?: string; routines?: boolean };

/** Top-level chats the Inbox shows (sub-threads between agents live inside their caller's chat). */
function visible(
  threads: Record<string, Thread>,
  opts: Filter,
  keep: (t: Thread) => boolean = (t) => inInbox(t, !!opts.routines),
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

/** One branch of the tree: an agent's chats, or (`engine`) an engine's own sessions, wherever they were started. */
export type AgentBranch = { agentId: string; engine?: string | undefined; threads: Thread[] };
export type ProjectTree = { key: string; project: Project | undefined; name: string; agents: AgentBranch[] };

/** Inbox organisation "b" (tree): project → agent → chats; busiest-recent first at every level. */
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
    // A Claude Code or Codex session belongs to that engine, not to the agent that holds the thread.
    const agentId = t.engine ? `engine:${t.engine}` : (t.agent_ids[0] ?? "");
    let branch = tree.agents.find((a) => a.agentId === agentId);
    if (!branch) {
      branch = { agentId, ...(t.engine ? { engine: t.engine } : {}), threads: [] };
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
