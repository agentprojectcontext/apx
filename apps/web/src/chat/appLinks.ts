// Where an app link an agent wrote goes (apx:settings/desktop, apx:tasks…): a place of the panel, or nothing for a
// link it does not know (shown as its label).
import { CONFIG_SECTIONS, type ConfigSection, go, nav, RESOURCE_TABS, type ResourceTab } from "../shell/nav.ts";

const isIn = <T extends string>(list: readonly T[], v: string | undefined): v is T =>
  v !== undefined && (list as readonly string[]).includes(v);

/** A place an `apx:` link names: what it is (for its icon and hint) and the move that opens it. */
export type AppPlace =
  | { kind: "settings"; section: ConfigSection; open: () => void }
  | { kind: "task"; id: string; open: () => void }
  | { kind: "tasks"; open: () => void }
  | { kind: "resources"; tab: ResourceTab; open: () => void }
  | { kind: "inbox"; open: () => void }
  | { kind: "chat"; id: string; open: () => void }
  | { kind: "project"; id: string; open: () => void }
  | { kind: "computer"; open: () => void };

/** The place an `apx:` link names; undefined when it names none. */
export function appPlace(href: string): AppPlace | undefined {
  const m = /^apx:([a-z]+)(?:\/([\w-]+))?(?:\/([\w-]+))?$/i.exec(href.trim());
  if (!m) return undefined;
  const [, where = "", a, b] = m;
  switch (where.toLowerCase()) {
    case "settings":
    case "config": {
      const section: ConfigSection | undefined = a === undefined ? "account" : isIn(CONFIG_SECTIONS, a) ? a : undefined;
      return section ? { kind: "settings", section, open: () => go.config(section) } : undefined;
    }
    case "tasks":
      return a ? { kind: "task", id: a, open: () => go.task(a) } : { kind: "tasks", open: () => go.view("tasks") };
    case "resources": {
      const tab: ResourceTab | undefined = a === undefined ? "skills" : isIn(RESOURCE_TABS, a) ? a : undefined;
      return tab ? { kind: "resources", tab, open: () => go.resources(tab, true) } : undefined;
    }
    case "inbox":
      return { kind: "inbox", open: () => go.inbox() };
    // The computer's panel beside the chat the link is in (its memory, its screen), or the Computers view.
    case "computer":
    case "computers":
      return {
        kind: "computer",
        open: () => (nav.get().threadId && where === "computer" ? go.panel("computer") : go.view("computers")),
      };
    case "thread":
    case "chat":
      return a ? { kind: "chat", id: a, open: () => go.inboxThread(a) } : undefined;
    case "project": {
      if (!a) return undefined;
      const tab = b === "chats" || b === "tasks" || b === "files" ? b : "overview";
      return { kind: "project", id: a, open: () => go.project(a, tab) };
    }
    default:
      return undefined;
  }
}
