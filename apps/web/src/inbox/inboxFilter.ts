import type { Project, Thread } from "@apx/protocol";
import { createStore, useSlice } from "../data/createStore.ts";
import { DEFAULT_PID, inProject } from "../data/identity.ts";

/** Who and where the Inbox narrows to: any of the agents, and any of the projects (a project takes its subprojects). */
export type InboxFilter = { agents: string[]; projects: string[] };

const store = createStore<InboxFilter>({ agents: [], projects: [] });
export const useInboxFilter = <T>(select: (s: InboxFilter) => T): T => useSlice(store, select);

export function toggleFilter(kind: keyof InboxFilter, id: string): void {
  store.set((s) => ({ [kind]: s[kind].includes(id) ? s[kind].filter((x) => x !== id) : [...s[kind], id] }));
}

export function clearFilter(): void {
  store.set({ agents: [], projects: [] });
}

/** Whether a chat passes the filter; nothing chosen of a kind lets every chat through for that kind. */
export function passesFilter(thread: Thread, f: InboxFilter, projects: readonly Project[]): boolean {
  const agentOk = !f.agents.length || thread.agent_ids.some((id) => f.agents.includes(id));
  const projectOk =
    !f.projects.length ||
    f.projects.some((pid) => {
      if (inProject(thread, pid)) return true;
      // A project's subprojects are part of it here.
      const own = projects.find((p) => p.id === thread.project_id);
      return Boolean(own?.parent) && (own?.parent === pid || (pid === DEFAULT_PID && own?.parent === DEFAULT_PID));
    });
  return agentOk && projectOk;
}
