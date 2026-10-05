import type { Agent, Thread } from "./useWorkspace";

/** Matches the web's data/identity and NewChatMenu selection rules. */
export function isWorking(state?: string): boolean {
  return state === "submitted" || state === "working";
}

export function activeThreads(threads: Thread[]): Thread[] {
  return threads
    .filter((thread) => isWorking(thread.state) || thread.state === "input-required")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function listedThreads(threads: Thread[]): Thread[] {
  return threads
    .filter((thread) => !thread.archived && !thread.parent_id && !["a2a", "task", "routine"].includes(thread.kind))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updated_at.localeCompare(a.updated_at));
}

export function chatAgents(agents: Agent[], projectId?: string): Agent[] {
  const secretary = agents.filter((agent) => agent.kind === "secretary");
  const own = agents
    .filter((agent) => agent.kind !== "secretary" && (projectId ? agent.project_id === projectId : !agent.project_id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...secretary, ...own];
}
