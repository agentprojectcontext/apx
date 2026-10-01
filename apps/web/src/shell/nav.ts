// UI navigation state (what is open), separate from data. Plain store so any component can navigate.
import type { ApxMode } from "@apx/ui";
import { createStore, useSlice } from "../data/createStore.ts";
import type { MessageKey } from "../i18n/index.ts";

export type PanelKind = "browser" | "terminal" | "files" | "widget" | "usage";

export type View = "inbox" | "project" | "app" | "tasks" | "resources";

export const PROJECT_TABS = [
  { id: "overview", label: "project.tab.overview" },
  { id: "chats", label: "project.tab.chats" },
  { id: "team", label: "project.tab.team" },
  { id: "tasks", label: "project.tab.tasks" },
  { id: "routines", label: "project.tab.routines" },
  { id: "files", label: "project.tab.files" },
  { id: "memory", label: "project.tab.memory" },
  { id: "resources", label: "project.tab.resources" },
] as const satisfies readonly { id: string; label: MessageKey }[];
export type ProjectTab = (typeof PROJECT_TABS)[number]["id"];

export const CONFIG_SECTIONS = [
  "account",
  "appearance",
  "engines",
  "router",
  "mcp",
  "agents",
  "whatsapp",
  "telegram",
  "discord",
  "browser",
  "desktop",
  "advanced",
] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

export type NavState = {
  view: View;
  /** Project open in the project view (also scopes its chat list). */
  projectId: string | undefined;
  projectTab: ProjectTab;
  threadId: string | undefined;
  appId: string | undefined;
  panel: PanelKind | null;
  browserTab: string | undefined;
  mode: ApxMode;
  /** Show tool-call groups in transcripts (chat header wrench). */
  tools: boolean;
  /** Config modal section, or null when closed. */
  config: ConfigSection | null;
  /** "Open on your phone" dialog. */
  phone: boolean;
};

const THEME_KEY = "apx.mode";

function initialMode(): ApxMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // Storage blocked: fall through to the system preference.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const PANELS: readonly PanelKind[] = ["browser", "terminal", "files", "widget", "usage"];
const TAB_IDS: readonly string[] = PROJECT_TABS.map((t) => t.id);
const VIEWS: readonly string[] = ["tasks", "resources"];

/** Deep links: #thread=<id>&panel=<kind>, #app=<id>, #project=<id>&tab=<tab>, #view=tasks. */
function fromHash(): Partial<NavState> {
  const h = new URLSearchParams(window.location.hash.slice(1));
  const panel = h.get("panel");
  const app = h.get("app");
  const project = h.get("project");
  const tab = h.get("tab");
  const view = h.get("view");
  return {
    ...(h.get("thread") ? { threadId: h.get("thread") ?? undefined } : {}),
    ...(panel && (PANELS as readonly string[]).includes(panel) ? { panel: panel as PanelKind } : {}),
    ...(project
      ? {
          view: "project" as const,
          projectId: project,
          projectTab: (tab && TAB_IDS.includes(tab) ? tab : "overview") as ProjectTab,
        }
      : {}),
    ...(view && VIEWS.includes(view) ? { view: view as View } : {}),
    ...(app ? { view: "app" as const, appId: app } : {}),
  };
}

export const nav = createStore<NavState>({
  view: "inbox",
  projectId: undefined,
  projectTab: "overview",
  threadId: "home",
  appId: undefined,
  panel: null,
  browserTab: undefined,
  mode: initialMode(),
  tools: true,
  config: null,
  phone: false,
  ...fromHash(),
});

nav.subscribe(() => {
  const s = nav.get();
  const h = new URLSearchParams();
  if (s.view === "app" && s.appId) h.set("app", s.appId);
  else if (s.view === "project" && s.projectId) {
    h.set("project", s.projectId);
    h.set("tab", s.projectTab);
    if (s.projectTab === "chats" && s.threadId) h.set("thread", s.threadId);
  } else if (s.view === "tasks" || s.view === "resources") h.set("view", s.view);
  else if (s.threadId) h.set("thread", s.threadId);
  if (s.panel && showsChat(s)) h.set("panel", s.panel);
  const next = `#${h.toString()}`;
  if (window.location.hash !== next) history.replaceState(null, "", next);
});

/** Inbox, or a project's Chats tab: the list + chat + side panel layout. */
export function showsChat(s: Pick<NavState, "view" | "projectTab">): boolean {
  return s.view === "inbox" || (s.view === "project" && s.projectTab === "chats");
}

export function useNav<T>(select: (s: NavState) => T): T {
  return useSlice(nav, select);
}

export const go = {
  inbox() {
    nav.set({ view: "inbox" });
  },
  /** Open a project. `threadId` picks the chat shown in its Chats tab. */
  project(projectId: string, tab: ProjectTab = "overview", threadId?: string) {
    nav.set((s) => ({ view: "project", projectId, projectTab: tab, threadId: threadId ?? s.threadId }));
  },
  projectTab(tab: ProjectTab) {
    nav.set({ projectTab: tab });
  },
  /** Open a chat where it lives: inside the open project's Chats tab, else in the Inbox. */
  thread(threadId: string) {
    nav.set((s) => (s.view === "project" && s.projectTab === "chats" ? { threadId } : { view: "inbox", threadId }));
  },
  /** Always the Inbox, whatever is open (running pill, deep links). */
  inboxThread(threadId: string) {
    nav.set({ view: "inbox", threadId });
  },
  app(appId: string) {
    nav.set({ view: "app", appId });
  },
  view(view: "tasks" | "resources") {
    nav.set({ view });
  },
  config(section: ConfigSection | null = "account") {
    nav.set({ config: section });
  },
  phone(open: boolean) {
    nav.set({ phone: open });
  },
  panel(panel: PanelKind | null) {
    nav.set({ panel });
  },
  togglePanel(panel: PanelKind) {
    nav.set((s) => ({ panel: s.panel === panel ? null : panel }));
  },
  browser(tab?: string) {
    nav.set((s) => ({
      panel: "browser",
      browserTab: tab ?? s.browserTab,
      ...(showsChat(s) ? {} : { view: "inbox" as const }),
    }));
  },
  toggleTools() {
    nav.set((s) => ({ tools: !s.tools }));
  },
  setMode(mode: ApxMode) {
    nav.set({ mode });
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // Not persisted: fine.
    }
  },
  toggleMode() {
    go.setMode(nav.get().mode === "dark" ? "light" : "dark");
  },
};
