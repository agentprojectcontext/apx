import type { Project, Thread } from "@apx/protocol";
import { DEFAULT_PROJECT, inProject, isWorking } from "../data/identity.ts";

export type ThreadGroup = {
  key: string;
  project: Project | undefined;
  name: string;
  threads: Thread[];
  running: number;
};

const NO_PROJECT = "__none__";

/** Inbox organisation "a" (Por chat): top-level threads grouped by project, most recent group first. */
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
