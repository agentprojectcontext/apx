import type { Project, Thread } from "@apx/protocol";
import { DEFAULT_PROJECT, inProject, isWorking } from "../data/identity.ts";

/** Top-level chats the Inbox shows (sub-threads between agents live inside their caller's chat). */
function visible(threads: Record<string, Thread>, opts: { projectId?: string; query?: string }): Thread[] {
  const q = opts.query?.trim().toLowerCase();
  return Object.values(threads).filter(
    (t) =>
      !t.parent_id &&
      t.kind !== "a2a" &&
      (!opts.projectId || inProject(t, opts.projectId)) &&
      (!q || `${t.title} ${t.preview}`.toLowerCase().includes(q)),
  );
}

const newest = (a: Thread, b: Thread) => b.updated_at.localeCompare(a.updated_at);

export type ThreadGroup = {
  key: string;
  project: Project | undefined;
  name: string;
  threads: Thread[];
  running: number;
};

const NO_PROJECT = "__none__";

/** Inbox organisation "a" (by chat): top-level threads grouped by project, most recent group first. */
export function groupByProject(
  threads: Record<string, Thread>,
  projects: Project[],
  opts: { projectId?: string; query?: string },
): ThreadGroup[] {
  const q = opts.query?.trim().toLowerCase();
  const byId = new Map(projects.map((p) => [p.id, p]));
  const groups = new Map<string, ThreadGroup>();
  for (const t of Object.values(threads)) {
    if (t.parent_id || t.kind === "a2a") continue;
    if (opts.projectId && !inProject(t, opts.projectId)) continue;
    if (q && !`${t.title} ${t.preview}`.toLowerCase().includes(q)) continue;
    const key = t.project_id ?? NO_PROJECT;
    let g = groups.get(key);
    if (!g) {
      const project = t.project_id ? byId.get(t.project_id) : undefined;
      g = { key, project, name: project?.name ?? DEFAULT_PROJECT, threads: [], running: 0 };
      groups.set(key, g);
    }
    g.threads.push(t);
    if (isWorking(t.state)) g.running++;
  }
  const out = [...groups.values()];
  for (const g of out) g.threads.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  out.sort((a, b) => (b.threads[0]?.updated_at ?? "").localeCompare(a.threads[0]?.updated_at ?? ""));
  return out;
}

export type AgentBranch = { agentId: string; threads: Thread[] };
export type ProjectTree = { key: string; project: Project | undefined; name: string; agents: AgentBranch[] };

/** Inbox organisation "b" (tree): project → agent → chats; busiest-recent first at every level. */
export function groupByAgent(
  threads: Record<string, Thread>,
  projects: Project[],
  opts: { projectId?: string; query?: string },
): ProjectTree[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const trees = new Map<string, ProjectTree>();
  for (const t of visible(threads, opts).sort(newest)) {
    const key = t.project_id ?? NO_PROJECT;
    let tree = trees.get(key);
    if (!tree) {
      const project = t.project_id ? byId.get(t.project_id) : undefined;
      tree = { key, project, name: project?.name ?? DEFAULT_PROJECT, agents: [] };
      trees.set(key, tree);
    }
    const agentId = t.agent_ids[0] ?? "";
    let branch = tree.agents.find((a) => a.agentId === agentId);
    if (!branch) {
      branch = { agentId, threads: [] };
      tree.agents.push(branch);
    }
    branch.threads.push(t);
  }
  return [...trees.values()];
}

export type TimeBucket = "running" | "today" | "yesterday" | "week" | "earlier";
export type ActivityGroup = { bucket: TimeBucket; threads: Thread[] };

/** Inbox organisation "c" (activity): what runs now on top, then by when it last moved. */
export function groupByTime(
  threads: Record<string, Thread>,
  opts: { projectId?: string; query?: string },
  now = new Date(),
): ActivityGroup[] {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const bucketOf = (t: Thread): TimeBucket => {
    if (isWorking(t.state) || t.state === "input-required") return "running";
    const at = Date.parse(t.updated_at);
    if (at >= day) return "today";
    if (at >= day - 86_400_000) return "yesterday";
    if (at >= day - 6 * 86_400_000) return "week";
    return "earlier";
  };
  const order: TimeBucket[] = ["running", "today", "yesterday", "week", "earlier"];
  const groups = new Map<TimeBucket, Thread[]>();
  for (const t of visible(threads, opts).sort(newest)) groups.set(bucketOf(t), [...(groups.get(bucketOf(t)) ?? []), t]);
  return order.flatMap((bucket) => {
    const list = groups.get(bucket);
    return list ? [{ bucket, threads: list }] : [];
  });
}
