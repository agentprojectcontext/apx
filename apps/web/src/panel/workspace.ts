// The open chat's folder: its own (a code session's) or its project's. Terminal, Files and Changes need one.
import type { Thread } from "@apx/protocol";
import { findProject, type ProjectEntry } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useNav } from "../shell/nav.ts";

export type Workspace = { thread: Thread; project: ProjectEntry & { path: string }; folder: string };

/** The folder a chat works in, when its project has one on disk. */
export function useWorkspace(): Workspace | undefined {
  const threadId = useNav((s) => s.threadId);
  const thread = useData((s) => (threadId ? s.threads[threadId] : undefined));
  const projects = useData((s) => s.projects);
  if (!thread?.project_id) return undefined;
  const p = projects.find((x) => x.id === thread.project_id);
  const entry = findProject(projects, thread.project_id);
  if (!p?.path || !p.present || !entry) return undefined;
  return { thread, project: { ...entry, path: p.path }, folder: thread.cwd ?? p.path };
}
