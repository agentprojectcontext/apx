// UI navigation state (what is open), separate from data. Plain store so any component can navigate.
import type { ApxMode } from "@apx/ui";
import type { ChannelKind } from "../channels/kinds.ts";
import { createStore, useSlice } from "../data/createStore.ts";
import { rememberSidebar } from "../data/prefs.ts";
import type { MessageKey } from "../i18n/index.ts";

export type PanelKind =
  | "computer"
  | "browser"
  | "terminal"
  | "files"
  | "changes"
  | "widget"
  | "usage"
  | "agent"
  | "processes"
  | "document";

export type View = "inbox" | "project" | "app" | "tasks" | "resources" | "computers" | "channel" | "engine";

export const PROJECT_TABS = [
  { id: "overview", label: "project.tab.overview" },
  { id: "chats", label: "project.tab.chats" },
  { id: "team", label: "project.tab.team" },
  { id: "tasks", label: "project.tab.tasks" },
  { id: "routines", label: "project.tab.routines" },
  { id: "artifacts", label: "project.tab.artifacts" },
  { id: "files", label: "project.tab.files" },
  { id: "memory", label: "project.tab.memory" },
  { id: "resources", label: "project.tab.resources" },
] as const satisfies readonly { id: string; label: MessageKey }[];
export type ProjectTab = (typeof PROJECT_TABS)[number]["id"];

export const CONFIG_SECTIONS = [
  "account",
  "appearance",
  "sounds",
  "engines",
  "external",
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
  "logs",
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
  panelDocument: string | undefined;
  /** The one widget the widget panel shows (moved there from the chat); without one it lists the chat's widgets. */
  panelWidget: string | undefined;
  /** The terminal tab to bring forward in the terminal panel (one just opened to run a command). */
  panelTerminal: string | undefined;
  /** The agent the "agent" side panel shows (opened from its face or name in a chat). */
  panelAgent: string | undefined;
  panelThread: string | undefined;
  panelParent: string | undefined;
  mode: ApxMode;
  /** Show tool-call groups in transcripts (chat header wrench). */
  tools: boolean;
  /** Config modal section, or null when closed. */
  config: ConfigSection | null;
  /** The channel kind shown in Config › Channels (connected or being set up). */
  configChannel: ChannelKind | undefined;
  /** "Open on your phone" dialog. */
  phone: boolean;
  /** The usage dialog (memory, CPU, disk; the computer's and APX's). */
  usageDialog: boolean;
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
  /** The task open beside a tasks list (the Tasks screen or a project's Tasks tab). */
  taskId: string | undefined;
  /** A task open over any other screen (from a chat), so the owner does not leave it. */
  peekTaskId: string | undefined;
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

const PANELS: readonly PanelKind[] = [
  "computer",
  "browser",
  "terminal",
  "files",
  "changes",
  "widget",
  "usage",
  "processes",
  "document",
];
const TAB_IDS: readonly string[] = PROJECT_TABS.map((t) => t.id);
const VIEWS: readonly string[] = ["tasks", "resources", "computers"];

/** Deep links: #thread=<id>&panel=<kind>, #app=<id>, #project=<id>&tab=<tab>, #view=tasks&task=<id>. */
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
    ...(h.get("task") ? { taskId: h.get("task") ?? undefined } : {}),
    ...(panel && (PANELS as readonly string[]).includes(panel) ? { panel: panel as PanelKind } : {}),
    panelDocument: panel === "document" ? (h.get("document") ?? undefined) : undefined,
    panelWidget: panel === "widget" ? (h.get("widget") ?? undefined) : undefined,
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
  panelDocument: undefined,
  panelWidget: undefined,
  panelTerminal: undefined,
  panelAgent: undefined,
  panelThread: undefined,
  panelParent: undefined,
  mode: initialMode(),
  tools: true,
  config: null,
  configChannel: undefined,
  phone: false,
  usageDialog: false,
  palette: false,
  listInFront: false,
  resourcesTab: "skills",
  channelId: undefined,
  channelThread: undefined,
  engineId: undefined,
  focus: undefined,
  taskId: undefined,
  peekTaskId: undefined,
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
  | "taskId"
  | "resourcesTab"
  | "listInFront"
  | "panel"
  | "panelWide"
  | "browserTab"
  | "panelDocument"
  | "panelWidget"
  | "panelAgent"
  | "panelThread"
  | "panelParent"
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
    taskId: s.taskId,
    resourcesTab: s.resourcesTab,
    listInFront: s.listInFront,
    panel: s.panel,
    panelWide: s.panelWide,
    browserTab: s.browserTab,
    panelDocument: s.panelDocument,
    panelWidget: s.panelWidget,
    panelAgent: s.panelAgent,
    panelThread: s.panelThread,
    panelParent: s.panelParent,
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
const past: Place[] = [];
let future: Place[] = [];
let currentPlace = placeOf(nav.get());
/** True while back/forward applies a place so that restore does not push itself. */
let applyingHistory = false;

function syncHist(): void {
  hist.set({ canBack: past.length > 0, canForward: future.length > 0 });
}

function rememberPlace(next: Place): void {
  if (applyingHistory) return;
  if (samePlace(next, currentPlace)) {
    currentPlace = next;
    return;
  }
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
    if (s.projectTab === "tasks" && s.taskId) h.set("task", s.taskId);
  } else if (s.view === "tasks" || s.view === "resources" || s.view === "computers") {
    h.set("view", s.view);
    if (s.view === "tasks" && s.taskId) h.set("task", s.taskId);
  } else if (s.view === "channel" && s.channelId) {
    h.set("channel", s.channelId);
    if (s.channelThread) h.set("chat", s.channelThread);
  } else if (s.view === "engine" && s.engineId) {
    h.set("engine", s.engineId);
    if (s.threadId) h.set("thread", s.threadId);
  } else if (s.threadId) h.set("thread", s.threadId);
  if (s.panel && showsChat(s)) h.set("panel", s.panel);
  if (s.panel === "document" && showsChat(s) && s.panelDocument) h.set("document", s.panelDocument);
  if (s.panel === "widget" && showsChat(s) && s.panelWidget) h.set("widget", s.panelWidget);
  const next = `#${h.toString()}`;
  if (window.location.hash !== next) history.replaceState(null, "", next);
  rememberPlace(placeOf(s));
});

// The browser belongs to the chat it was open in: another chat opens without it, so the page leaves the screen
// (a link or Back that names the browser together with the chat still opens it).
let shownThread = nav.get().threadId;
let shownPanel = nav.get().panel;
nav.subscribe(() => {
  const s = nav.get();
  const left = s.threadId !== shownThread && s.panel === "browser" && shownPanel === "browser" && !applyingHistory;
  shownThread = s.threadId;
  shownPanel = s.panel;
  if (left) nav.set({ panel: null });
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
    const previous = past.pop();
    if (!previous) return;
    future.unshift(currentPlace);
    applyPlace(previous);
  },
  /** Place undoing the last back. */
  forward() {
    const next = future.shift();
    if (!next) return;
    past.push(currentPlace);
    applyPlace(next);
  },
  inbox() {
    nav.set({ view: "inbox" });
  },
  /** Open a project. Without `tab`, a project opened from another keeps its tab; `threadId` picks the chat in Chats. */
  project(projectId: string, tab?: ProjectTab, threadId?: string) {
    nav.set((s) => ({
      view: "project",
      projectId,
      projectTab: tab ?? (s.view === "project" ? s.projectTab : "overview"),
      threadId: threadId ?? s.threadId,
      // The task open beside the list belongs to the project it was opened in.
      ...(s.projectId !== projectId ? { taskId: undefined } : {}),
    }));
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
  /** A new chat just made takes the place of the empty one it was, wherever it is open; back skips the empty one. */
  madeThread(newId: string, threadId: string) {
    if (nav.get().threadId !== newId) return;
    applyingHistory = true;
    nav.set({ threadId });
    applyingHistory = false;
    currentPlace = placeOf(nav.get());
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
    rememberSidebar("engineOrder", engineId);
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
  view(view: "tasks" | "resources" | "computers") {
    nav.set({ view });
  },
  /** A task: beside a tasks list when one is open, else over the current screen (a chat, a notice…). */
  task(taskId: string) {
    nav.set((s) =>
      s.view === "tasks" || (s.view === "project" && s.projectTab === "tasks") ? { taskId } : { peekTaskId: taskId },
    );
  },
  /** The whole Tasks screen with this task open (from a task shown over another screen). */
  taskInList(taskId: string) {
    nav.set({ view: "tasks", taskId, peekTaskId: undefined });
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
  usageDialog(open: boolean) {
    nav.set({ usageDialog: open });
  },
  /** An agent's block beside the chat: its settings, prompt and routines, with Edit. */
  agent(agentId: string) {
    nav.set({ panel: "agent", panelAgent: agentId });
  },
  /** A sub-chat beside the open chat; with no chat open (Tasks, a task over the screen) it opens as a chat itself. */
  subthread(thread: string) {
    nav.set((s) => {
      const chat =
        s.view === "inbox" ||
        s.view === "engine" ||
        s.view === "channel" ||
        (s.view === "project" && s.projectTab === "chats");
      if (!chat || !s.threadId || s.peekTaskId)
        return { view: "inbox", threadId: thread, peekTaskId: undefined, panel: null, listInFront: false };
      return { panel: "processes", panelThread: thread, panelParent: s.threadId, listInFront: false };
    });
  },
  processes() {
    nav.set({ panel: "processes", panelThread: undefined, panelParent: undefined });
  },
  panel(panel: PanelKind | null) {
    nav.set({ panel, panelThread: undefined, panelParent: undefined, panelWidget: undefined });
  },
  /** The terminal panel, showing that terminal. */
  terminal(terminalId: string) {
    nav.set({ panel: "terminal", panelTerminal: terminalId, panelThread: undefined, panelParent: undefined });
  },
  /** The documents panel: that document, or without one the chat's list of them. */
  document(mediaId?: string) {
    nav.set({ panel: "document", panelDocument: mediaId, panelThread: undefined, panelParent: undefined });
  },
  /** The widget panel showing that one widget (the chat keeps a card of it), or without one the chat's widgets. */
  widget(surfaceId?: string) {
    nav.set({ panel: "widget", panelWidget: surfaceId, panelThread: undefined, panelParent: undefined });
  },
  togglePanelWide() {
    nav.set((s) => ({ panelWide: !s.panelWide }));
  },
  togglePanel(panel: PanelKind) {
    nav.set((s) => ({
      panel: s.panel === panel ? null : panel,
      panelThread: undefined,
      panelParent: undefined,
      panelWidget: undefined,
    }));
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
