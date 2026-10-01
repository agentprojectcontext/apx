import type { Agent, Project, Thread } from "@apx/protocol";
import { BLOB_NAMES } from "@apx/ui";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The stored blob, or a stable one derived from the id so every agent/project has a face. */
export function blobOf(entity: { id: string; blob?: string } | undefined): string | undefined {
  if (!entity) return undefined;
  if (entity.blob) return entity.blob;
  return BLOB_NAMES[hash(entity.id) % BLOB_NAMES.length];
}

/** The agent that speaks in a thread (first participant). */
export function threadAgent(thread: Thread | undefined, agents: Record<string, Agent>): Agent | undefined {
  const id = thread?.agent_ids[0];
  return id ? agents[id] : undefined;
}

export function secretary(agents: Record<string, Agent>): Agent | undefined {
  return Object.values(agents).find((a) => a.kind === "secretary");
}

export function projectName(projects: Project[], id: string | undefined): string {
  if (!id) return DEFAULT_PROJECT;
  return projects.find((p) => p.id === id)?.name ?? DEFAULT_PROJECT;
}

/** Group label for threads without a project. */
export const DEFAULT_PROJECT = "Default";

export function isWorking(state: Thread["state"] | undefined): boolean {
  return state === "submitted" || state === "working";
}
