import type { Agent, Project, Thread } from "@apx/protocol";
import { BLOB_NAMES, type TileTone } from "@apx/ui";
import { data } from "./state.ts";

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
  if (!id) return baseName();
  return projects.find((p) => p.id === id)?.name ?? baseName();
}

/** The base project's name as the owner set it ("Default" until then): the label of what has no project. */
export const baseName = (): string => data.get().base.name;

/** Delegated chats shown under their caller before "N more" (and how many the list loads per chat). */
export const DELEGATED_SHOWN = 5;

/** Threads the chat lists show: not archived, a sub-thread between agents, nor a task's or a routine's conversation. */
export function isListed(t: Pick<Thread, "parent_id" | "kind" | "archived">): boolean {
  return !t.archived && isTopLevel(t);
}

/**
 * What the Inbox lists: the chats, and with `routines` the routine runs that told something (a quiet run is archived;
 * one still running waits until it has said it).
 */
export function inInbox(t: Pick<Thread, "parent_id" | "kind" | "archived" | "state">, routines: boolean): boolean {
  return isListed(t) || (routines && t.kind === "routine" && !t.parent_id && !t.archived && !isWorking(t.state));
}

/** A routine run's chat is titled "<routine> · <when>". */
export const routineName = (t: Pick<Thread, "title">): string => t.title.split(" · ")[0] ?? t.title;

/** A chat of its own (not a sub-thread, a task's or a routine's), archived or not. */
export function isTopLevel(t: Pick<Thread, "parent_id" | "kind">): boolean {
  return !t.parent_id && t.kind !== "a2a" && t.kind !== "task" && t.kind !== "routine";
}

export function isWorking(state: Thread["state"] | undefined): boolean {
  return state === "submitted" || state === "working";
}

/** Nav id of the base space (threads and agents without a project). Never a real project id (those are p_…). */
export const DEFAULT_PID = "~default";

/** Real project id for a nav project id: the base space has none. */
export function realProjectId(pid: string | undefined): string | undefined {
  return pid === DEFAULT_PID ? undefined : pid;
}

/** Whether a thread or agent belongs to a nav project (the base space owns everything without one). */
export function inProject(item: { project_id?: string }, pid: string | undefined): boolean {
  return pid === DEFAULT_PID ? !item.project_id : item.project_id === pid;
}

const TONES = ["violet", "info", "warning", "danger", "brand"] as const satisfies readonly TileTone[];

/** Stable tile color per project; the base space is always brand. */
export function projectTone(id: string): TileTone {
  if (id === DEFAULT_PID) return "brand";
  return TONES[hash(id) % TONES.length] ?? "violet";
}

export function projectInitial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export type ProjectEntry = {
  id: string;
  name: string;
  path: string | undefined;
  isDefault: boolean;
  kind?: string | undefined;
};

/** Sidebar order: the base space first, then the real projects as the core lists them. */
export function projectEntries(projects: Project[]): ProjectEntry[] {
  return [
    { id: DEFAULT_PID, name: baseName(), path: undefined, isDefault: true, kind: data.get().base.kind },
    ...projects
      .filter((p) => p.registered !== false)
      .map((p) => ({ id: p.id, name: p.name, path: p.path, isDefault: false, kind: p.kind })),
  ];
}

export function findProject(projects: Project[], pid: string | undefined): ProjectEntry | undefined {
  return pid ? projectEntries(projects).find((p) => p.id === pid) : undefined;
}

/** The project's agents; the base space shows the super-agent and agents without a project. */
export function teamOf(agents: Record<string, Agent>, pid: string): Agent[] {
  return Object.values(agents)
    .filter((a) => inProject(a, pid))
    .sort((a, b) => Number(b.kind === "secretary") - Number(a.kind === "secretary") || a.name.localeCompare(b.name));
}
