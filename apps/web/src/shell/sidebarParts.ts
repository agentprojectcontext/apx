import { Icons, type MenuEntry } from "@apx/ui";
import { createElement } from "react";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

/** The sidebar's views (its top rows) and sections: the owner may hide them and change their order. */
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

export type ViewId = (typeof SIDEBAR_VIEWS)[number]["id"];
export type SectionId = (typeof SIDEBAR_SECTIONS)[number]["id"];
type PartId = ViewId | SectionId;
type Part = (typeof SIDEBAR_VIEWS)[number] | (typeof SIDEBAR_SECTIONS)[number];

/** Whether a sidebar view or section shows: all do until the owner hides one. */
export function useSidebarShows(): (id: PartId) => boolean {
  const hidden = usePrefs((s) => s.navHidden);
  return (id) => !hidden.includes(id);
}

/** Ids in the owner's order: the ones they placed first, then the rest as they come. */
export function inOrder<T extends string>(ids: readonly T[], order: readonly string[]): T[] {
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length + ids.indexOf(id as T) : i;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

/** Puts `id` at `index` of the current order and keeps it. */
export function moveSidebarPart(
  kind: "navOrder" | "sectionOrder",
  order: readonly string[],
  id: string,
  index: number,
) {
  const ids = order.filter((x) => x !== id);
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
  setPrefs({ [kind]: ids });
}

/**
 * The sidebar's own menu (right click on it, and the account menu): which views and sections show, and whether it is
 * compact.
 */
export function useSidebarMenu(withCompact = true): MenuEntry[] {
  const t = useT();
  const hidden = usePrefs((s) => s.navHidden);
  const compact = usePrefs((s) => s.sidebarCompact);
  const part = (p: Part): MenuEntry => ({
    label: t(p.label),
    checked: !hidden.includes(p.id),
    keepOpen: true,
    onSelect: () =>
      setPrefs({ navHidden: hidden.includes(p.id) ? hidden.filter((x) => x !== p.id) : [...hidden, p.id] }),
  });
  return [
    { type: "label", label: t("nav.showViews") },
    ...SIDEBAR_VIEWS.map(part),
    { type: "separator" },
    { type: "label", label: t("nav.showSections") },
    ...SIDEBAR_SECTIONS.map(part),
    ...(withCompact
      ? ([
          { type: "separator" },
          {
            label: t("appearance.compact"),
            icon: createElement(Icons.PanelLeftClose),
            checked: compact,
            keepOpen: true,
            onSelect: () => setPrefs({ sidebarCompact: !compact }),
          },
        ] satisfies MenuEntry[])
      : []),
  ];
}
