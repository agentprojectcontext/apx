// Where an app link an agent wrote goes (apx:settings/desktop, apx:tasks…): a place of the panel, or nothing for a
// link it does not know (shown as its label).
import { CONFIG_SECTIONS, type ConfigSection, go, RESOURCE_TABS, type ResourceTab } from "../shell/nav.ts";

const isIn = <T extends string>(list: readonly T[], v: string | undefined): v is T =>
  v !== undefined && (list as readonly string[]).includes(v);

/** The place an `apx:` link names, as the move that opens it; undefined when it names none. */
export function appPlace(href: string): (() => void) | undefined {
  const m = /^apx:([a-z]+)(?:\/([\w-]+))?(?:\/([\w-]+))?$/i.exec(href.trim());
  if (!m) return undefined;
  const [, where = "", a, b] = m;
  switch (where.toLowerCase()) {
    case "settings":
    case "config": {
      const section: ConfigSection | undefined = a === undefined ? "account" : isIn(CONFIG_SECTIONS, a) ? a : undefined;
      return section ? () => go.config(section) : undefined;
    }
    case "tasks":
      return a ? () => go.task(a) : () => go.view("tasks");
    case "resources": {
      const tab: ResourceTab | undefined = a === undefined ? "skills" : isIn(RESOURCE_TABS, a) ? a : undefined;
      return tab ? () => go.resources(tab, true) : undefined;
    }
    case "inbox":
      return () => go.inbox();
    case "thread":
    case "chat":
      return a ? () => go.inboxThread(a) : undefined;
    case "project":
      return a ? () => go.project(a, b === "chats" || b === "tasks" || b === "files" ? b : "overview") : undefined;
    default:
      return undefined;
  }
}
