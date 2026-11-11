// A project's tabs and the tab a link names.
import type { MessageKey } from "../i18n/index.ts";

export const PROJECT_TABS = [
  { id: "overview", label: "project.tab.overview" },
  { id: "chats", label: "project.tab.chats" },
  { id: "team", label: "project.tab.team" },
  { id: "tasks", label: "project.tab.tasks" },
  { id: "routines", label: "project.tab.routines" },
  { id: "shared", label: "project.tab.shared" },
  { id: "folder", label: "project.tab.folder" },
  { id: "memory", label: "project.tab.memory" },
  { id: "resources", label: "project.tab.resources" },
] as const satisfies readonly { id: string; label: MessageKey }[];
export type ProjectTab = (typeof PROJECT_TABS)[number]["id"];

const IDS: readonly string[] = PROJECT_TABS.map((t) => t.id);
/** Tabs links still name: Artifacts is now under Files, and the old Files tab is Directory. */
const RENAMED = new Map<string, ProjectTab>([
  ["artifacts", "shared"],
  ["files", "folder"],
]);

/** The tab a link's `tab=` opens; an unknown or missing one opens the overview. */
export function projectTabFrom(tab: string | null | undefined): ProjectTab {
  if (!tab) return "overview";
  if (IDS.includes(tab)) return tab as ProjectTab;
  return RENAMED.get(tab) ?? "overview";
}
