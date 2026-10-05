// UI navigation state (what is open), separate from data. Plain store so any component can navigate.
import type { ApxMode } from "@apx/ui";
import type { ChannelKind } from "../channels/kinds.ts";
import { createStore, useSlice } from "../data/createStore.ts";
import type { MessageKey } from "../i18n/index.ts";

export type PanelKind = "browser" | "terminal" | "files" | "changes" | "widget" | "usage" | "agent";

export type View = "inbox" | "project" | "app" | "tasks" | "resources" | "channel" | "engine";

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
  "agents",
  "profile",
  "memory",
  "voices",
  "images",
  "channels",
  "interruptions",
  "browser",
  "desktop",
  "devices",
  "api",
  "advanced",
] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

export const RESOURCE_TABS = ["skills", "mcp", "integrations", "variables", "extensions"] as const;
export type ResourceTab = (typeof RESOURCE_TABS)[number];

export type NavState = {
  view: View;
  /** Project open in the project view (also scopes its chat list). */
  projectId: string | undefined;
  projectTab: ProjectTab;
  threadId: string | undefined;
  appId: string | undefined;
  panel: PanelKind | null;
  /** The side panel takes half the chat area (files, changes, a terminal), instead of its usual column. */
  panelWide: boolean;
  browserTab: string | undefined;
  /** The agent the "agent" side panel shows (opened from its face or name in a chat). */
  panelAgent: string | undefined;
  mode: ApxMode;
  /** Show tool-call groups in transcripts (chat header wrench). */
  tools: boolean;
  /** Config modal section, or null when closed. */
  config: ConfigSection | null;
  /** The channel kind shown in Config › Channels (connected or being set up). */
  configChannel: ChannelKind | undefined;
  /** "Open on your phone" dialog. */
  phone: boolean;
  /** The ⌘K palette is open. */
  palette: boolean;
  /** Phone-width windows show the chat list or the chat, not both: true while the list is in front. */
  listInFront: boolean;
  /** Tab of Resources (global, and inside a project). */
  resourcesTab: ResourceTab;
  /** The channel open in the channel view, and the contact's chat picked in it. */
  channelId: string | undefined;
  channelThread: string | undefined;
  /** The engine whose sessions are open (external sessions: "claude", "codex", "acp:opencode"). */
  engineId: string | undefined;
  /** What a notice or link pointed at, lit once where it shows (see useFlash). */
  focus: string | undefined;
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

const PANELS: readonly PanelKind[] = ["browser", "terminal", "files", "changes", "widget", "usage"];
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
  const channel = h.get("channel");
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
    ...(channel ? { view: "channel" as const, channelId: channel, channelThread: h.get("chat") ?? undefined } : {}),
    // An engine's view opens on one of its sessions or on none: never on the chat the app started with.
    ...(h.get("engine")
      ? { view: "engine" as const, engineId: h.get("engine") ?? undefined, threadId: h.get("thread") ?? undefined }
      : {}),
  };
}

export const nav = createStore<NavState>({
  view: "inbox",
  projectId: undefined,
  projectTab: "overview",
  threadId: "home",
  appId: undefined,
  panel: null,
  panelWide: false,
  browserTab: undefined,
  panelAgent: undefined,
  mode: initialMode(),
  tools: true,
  config: null,
  configChannel: undefined,
  phone: false,
  palette: false,
  listInFront: false,
  resourcesTab: "skills",
  channelId: undefined,
  channelThread: undefined,
  engineId: undefined,
  focus: undefined,
  ...fromHash(),
});

/** A place the owner can go back to (overlays like config/palette stay out). */
type Place = Pick<
  NavState,
  | "view"
  | "projectId"
  | "projectTab"
  | "threadId"
  | "appId"
  | "channelId"
  | "channelThread"
  | "engineId"
  | "resourcesTab"
  | "listInFront"
>;

const MAX_HISTORY = 50;

function placeOf(s: NavState): Place {
  return {
    view: s.view,
    projectId: s.projectId,
    projectTab: s.projectTab,
    threadId: s.threadId,
    appId: s.appId,
    channelId: s.channelId,
    channelThread: s.channelThread,
    engineId: s.engineId,
    resourcesTab: s.resourcesTab,
    listInFront: s.listInFront,
  };
}

function samePlace(a: Place, b: Place): boolean {
  return (
    a.view === b.view &&
    a.projectId === b.projectId &&
    a.projectTab === b.projectTab &&
    a.threadId === b.threadId &&
    a.appId === b.appId &&
    a.channelId === b.channelId &&
    a.channelThread === b.channelThread &&
    a.engineId === b.engineId &&
    a.resourcesTab === b.resourcesTab &&
    a.listInFront === b.listInFront
  );
}

type HistState = { canBack: boolean; canForward: boolean };
const hist = createStore<HistState>({ canBack: false, canForward: false });
let past: Place[] = [];
let future: Place[] = [];
let currentPlace = placeOf(nav.get());
/** True while back/forward applies a place so that restore does not push itself. */
let applyingHistory = false;

function syncHist(): void {
  hist.set({ canBack: past.length > 0, canForward: future.length > 0 });
}

function rememberPlace(next: Place): void {
  if (applyingHistory || samePlace(next, currentPlace)) return;
  past.push(currentPlace);
  if (past.length > MAX_HISTORY) past.shift();
  future = [];
  currentPlace = next;
  syncHist();
}

function applyPlace(place: Place): void {
  applyingHistory = true;
  nav.set(place);
  currentPlace = place;
  applyingHistory = false;
  syncHist();
}

nav.subscribe(() => {
  const s = nav.get();
  const h = new URLSearchParams();
  if (s.view === "app" && s.appId) h.set("app", s.appId);
  else if (s.view === "project" && s.projectId) {
    h.set("project", s.projectId);
    h.set("tab", s.projectTab);
    if (s.projectTab === "chats" && s.threadId) h.set("thread", s.threadId);
  } else if (s.view === "tasks" || s.view === "resources") h.set("view", s.view);
  else if (s.view === "channel" && s.channelId) {
    h.set("channel", s.channelId);
    if (s.channelThread) h.set("chat", s.channelThread);
  } else if (s.view === "engine" && s.engineId) {
    h.set("engine", s.engineId);
    if (s.threadId) h.set("thread", s.threadId);
  } else if (s.threadId) h.set("thread", s.threadId);
  if (s.panel && showsChat(s)) h.set("panel", s.panel);
  const next = `#${h.toString()}`;
  if (window.location.hash !== next) history.replaceState(null, "", next);
  rememberPlace(placeOf(s));
});

// A deep link followed in place (a link in a message, the address bar); replaceState above never fires this.
window.addEventListener("hashchange", () => nav.set({ view: "inbox", panel: null, ...fromHash() }));

/** Inbox, or a project's Chats tab: the list + chat + side panel layout. */
export function showsChat(s: Pick<NavState, "view" | "projectTab">): boolean {
  return s.view === "inbox" || s.view === "engine" || (s.view === "project" && s.projectTab === "chats");
}

export function useNav<T>(select: (s: NavState) => T): T {
  return useSlice(nav, select);
}

export function useNavHistory<T>(select: (s: HistState) => T): T {
  return useSlice(hist, select);
}

export const go = {
  /** Previous place (inbox / project / chat…), not the browser tab history. */
  back() {
    if (!past.length) return;
    future.unshift(currentPlace);
    applyPlace(past.pop()!);
  },
  /** Place undoing the last back. */
  forward() {
    if (!future.length) return;
    past.push(currentPlace);
    applyPlace(future.shift()!);
  },
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
    nav.set((s) =>
      s.view === "project" && s.projectTab === "chats"
        ? { threadId, listInFront: false }
        : { view: "inbox", threadId, listInFront: false },
    );
  },
  /** Always the Inbox, whatever is open (running pill, deep links). */
  inboxThread(threadId: string) {
    nav.set({ view: "inbox", threadId, listInFront: false });
  },
  /** Phone width: back from a chat to the chat list. */
  showList() {
    nav.set({ listInFront: true, panel: null });
  },
  /** A channel's contacts and their chats; `thread` picks one. */
  channel(channelId: string, thread?: string) {
    nav.set((s) => ({
      view: "channel",
      channelId,
      channelThread: thread ?? (s.channelId === channelId ? s.channelThread : undefined),
    }));
  },
  /** Lights what a notice points at where it shows (see useFlash). */
  focus(key: string) {
    nav.set({ focus: key });
  },
  /** An engine's sessions (Claude Code, Codex…) beside the chat; `thread` opens one. */
  engine(engineId: string, thread?: string) {
    nav.set((s) => ({
      view: "engine",
      engineId,
      threadId: thread ?? (s.view === "engine" && s.engineId === engineId ? s.threadId : undefined),
      listInFront: !thread,
    }));
  },
  app(appId: string) {
    nav.set({ view: "app", appId });
  },
  view(view: "tasks" | "resources") {
    nav.set({ view });
  },
  /** A Resources tab: in the open project's Resources tab when a project is open, else the global screen. */
  resources(tab: ResourceTab, global = false) {
    nav.set((s) =>
      s.view === "project" && !global
        ? { projectTab: "resources", resourcesTab: tab }
        : { view: "resources", resourcesTab: tab },
    );
  },
  resourcesTab(tab: ResourceTab) {
    nav.set({ resourcesTab: tab });
  },
  config(section: ConfigSection | null = "account") {
    nav.set({ config: section });
  },
  /** Config › Channels on one kind: its settings, or its setup when it is not connected yet. */
  channelConfig(kind: ChannelKind) {
    nav.set({ config: "channels", configChannel: kind });
  },
  palette(open: boolean) {
    nav.set({ palette: open });
  },
  phone(open: boolean) {
    nav.set({ phone: open });
  },
  /** An agent's block beside the chat: its settings, prompt and routines, with Edit. */
  agent(agentId: string) {
    nav.set({ panel: "agent", panelAgent: agentId });
  },
  panel(panel: PanelKind | null) {
    nav.set({ panel });
  },
  togglePanelWide() {
    nav.set((s) => ({ panelWide: !s.panelWide }));
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
    window.apxDesktop?.setTitleBar?.(mode);
  },
  toggleMode() {
    go.setMode(nav.get().mode === "dark" ? "light" : "dark");
  },
};
