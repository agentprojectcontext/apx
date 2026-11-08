import { setPrefs, usePrefs } from "../data/prefs.ts";
import type { MessageKey } from "../i18n/index.ts";

/** The sidebar's views (its top rows) and sections, each of which the owner may hide. */
export const SIDEBAR_VIEWS = [
  { id: "inbox", label: "nav.inbox" },
  { id: "tasks", label: "nav.tasks" },
  { id: "flows", label: "nav.flows" },
  { id: "routines", label: "nav.routines" },
  { id: "resources", label: "nav.resources" },
  { id: "files", label: "nav.files" },
  { id: "computers", label: "nav.computers" },
] as const satisfies readonly { id: string; label: MessageKey }[];

export const SIDEBAR_SECTIONS = [
  { id: "projects", label: "nav.projects" },
  { id: "sessions", label: "nav.externalSessions" },
  { id: "channels", label: "nav.channels" },
  { id: "apps", label: "nav.apps" },
] as const satisfies readonly { id: string; label: MessageKey }[];

type PartId = (typeof SIDEBAR_VIEWS)[number]["id"] | (typeof SIDEBAR_SECTIONS)[number]["id"];

/** Whether a sidebar view or section shows: all do until the owner hides one. */
export function useSidebarShows(): (id: PartId) => boolean {
  const hidden = usePrefs((s) => s.navHidden);
  return (id) => !hidden.includes(id);
}

export function toggleSidebarPart(id: PartId, hidden: readonly string[]): void {
  setPrefs({ navHidden: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] });
}
