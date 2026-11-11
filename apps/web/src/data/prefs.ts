// Per-device preferences (this browser only): display name, appearance and sounds. Nothing here reaches the core.
import type { ApxLook } from "@apx/ui";
import { defaultLanguage, isLanguage, type Language } from "../i18n/messages.ts";
import { createStore, useSlice } from "./createStore.ts";
import type { NoticeSound } from "./noticeSound.ts";

type TranscriptWidth = "narrow" | "medium" | "wide";
export const TEXT_SIZES = [85, 100, 115, 130] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export function textSizeOf(value: unknown): TextSize {
  return TEXT_SIZES.find((size) => size === value) ?? 100;
}

type UiFont = "system" | "mono";

export type Prefs = {
  /** How the panel calls you (account row, greetings). Empty = not set: the UI says "You" in its language. */
  displayName: string;
  look: ApxLook;
  font: UiFont;
  textSize: TextSize;
  transcriptWidth: TranscriptWidth;
  /** UI language; English is the base, Spanish a translation. */
  language: Language;
  /** Sidebar: the Projects section is folded. */
  projectsFolded: boolean;
  /** Sidebar sections retain their folding independently. */
  channelsFolded: boolean;
  externalSessionsFolded: boolean;
  /** Channels in the owner's sidebar order; the first three stay visible. */
  channelOrder: string[];
  /** A manual reorder stays in place until newer channel activity arrives. */
  channelOrderAt: string;
  projectOrder: string[];
  engineOrder: string[];
  /** Rows each sidebar section shows before the rest folds into "N more" (0 = its minimum). */
  sidebarRows: SidebarRows;
  /** How the Inbox's Chats tab lists them: one list (pinned, recent, archived), project → agent → chats, by time, or by project. */
  /** The Inbox's tab: chats, tasks or routines. */
  inboxTab: InboxTab;
  /** Rows of the Inbox the owner opened (a chat's delegated chats, a task's chats, a section): closed until opened. */
  inboxOpen: string[];
  /** The Inbox lists routine runs that told something, besides the chats. */
  inboxRoutines: boolean;
  /** Channel accounts whose chats the Inbox leaves out (an account picked on its own still shows). */
  inboxHiddenChannels: string[];
  /** The Inbox lists each channel account's chats together, under one row that unfolds. */
  inboxByChannel: boolean;
  /** The Tasks screen shows one project's tasks (a nav project id) or every project's (""). */
  tasksProject: string;
  /** Columns the owner resized (px; 0 = the default) or folded away. */
  sidebarW: number;
  sidebarCollapsed: boolean;
  /** Each sidebar section is one row whose items open beside it; off, sections are cards (only when the window is tall enough). */
  sidebarCompact: boolean;
  /** Sidebar views and sections the owner hid from it (ids from shell/sidebarParts.ts). */
  navHidden: string[];
  /** The owner's order of the sidebar's views and of its sections (ids; the rest keep their place after them). */
  navOrder: string[];
  sectionOrder: string[];
  /** Unfolded by the owner in a window narrow enough to show the icon rail on its own. */
  sidebarOpen: boolean;
  listW: number;
  panelW: number;
  /**
   * Each project's board on this device: its widgets' order (by id), whether it takes the whole width, and the height
   * the owner dragged each tile to.
   */
  boards: Record<string, BoardPrefs>;
  /** A short chime when a voice note or read-aloud ends. */
  audioEndSound: boolean;
  /** Which notices make a sound as they arrive. */
  noticeSound: NoticeSound;
  /** How the top bar shows the AI quotas and the system resources: with their figures, or as a small mark. */
  quotaBar: BarShow;
  resourcesBar: BarShow;
};

export type BarShow = "full" | "mini";

/** `widths` are how many of the board's columns a tile spans (1 when absent). */
export type BoardPrefs = {
  order: string[];
  wide: boolean;
  heights: Record<string, number>;
  widths: Record<string, number>;
};

export type SidebarRows = { channels: number; projects: number; engines: number };

/** The fewest rows each sidebar section can be dragged down to, and what it shows until then. */
export const SIDEBAR_MIN_ROWS: SidebarRows = { channels: 3, projects: 5, engines: 3 };

export type InboxTab = "chats" | "tasks" | "routines";

const KEY = "apx.prefs";

const DEFAULTS: Prefs = {
  displayName: "",
  look: "minimal",
  font: "system",
  textSize: 100,
  transcriptWidth: "medium",
  language: defaultLanguage(),
  projectsFolded: false,
  channelsFolded: false,
  externalSessionsFolded: false,
  channelOrder: [],
  channelOrderAt: "",
  projectOrder: [],
  engineOrder: [],
  sidebarRows: { channels: 0, projects: 0, engines: 0 },
  inboxTab: "chats",
  inboxOpen: [],
  inboxRoutines: true,
  inboxHiddenChannels: [],
  inboxByChannel: false,
  tasksProject: "",
  sidebarW: 0,
  sidebarCollapsed: false,
  sidebarCompact: true,
  navHidden: [],
  navOrder: [],
  sectionOrder: [],
  sidebarOpen: false,
  listW: 0,
  panelW: 0,
  boards: {},
  audioEndSound: true,
  noticeSound: "all",
  quotaBar: "full",
  resourcesBar: "full",
};

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return {
      displayName: typeof raw.displayName === "string" ? raw.displayName.trim() : DEFAULTS.displayName,
      look: raw.look === "classic" ? "classic" : "minimal",
      font: raw.font === "mono" ? "mono" : "system",
      textSize: textSizeOf(raw.textSize),
      transcriptWidth:
        raw.transcriptWidth === "narrow" || raw.transcriptWidth === "wide" ? raw.transcriptWidth : "medium",
      language: isLanguage(raw.language) ? raw.language : DEFAULTS.language,
      projectsFolded: raw.projectsFolded === true,
      channelsFolded: raw.channelsFolded === true,
      externalSessionsFolded: raw.externalSessionsFolded === true,
      channelOrder: Array.isArray(raw.channelOrder)
        ? [...new Set(raw.channelOrder.filter((id): id is string => typeof id === "string"))]
        : [],
      channelOrderAt: typeof raw.channelOrderAt === "string" ? raw.channelOrderAt : "",
      projectOrder: Array.isArray(raw.projectOrder)
        ? [...new Set(raw.projectOrder.filter((id): id is string => typeof id === "string"))]
        : [],
      engineOrder: Array.isArray(raw.engineOrder)
        ? [...new Set(raw.engineOrder.filter((id): id is string => typeof id === "string"))]
        : [],
      sidebarRows: sidebarRowsOf(raw.sidebarRows),
      inboxTab: raw.inboxTab === "tasks" || raw.inboxTab === "routines" ? raw.inboxTab : "chats",
      inboxOpen: Array.isArray(raw.inboxOpen)
        ? [...new Set(raw.inboxOpen.filter((id): id is string => typeof id === "string"))].slice(-500)
        : [],
      inboxRoutines: raw.inboxRoutines !== false,
      inboxHiddenChannels: idsOf(raw.inboxHiddenChannels),
      inboxByChannel: raw.inboxByChannel === true,
      tasksProject: typeof raw.tasksProject === "string" ? raw.tasksProject : "",
      sidebarW: typeof raw.sidebarW === "number" ? raw.sidebarW : 0,
      sidebarCollapsed: raw.sidebarCollapsed === true,
      sidebarCompact: raw.sidebarCompact !== false,
      navOrder: idsOf(raw.navOrder),
      sectionOrder: idsOf(raw.sectionOrder),
      navHidden: Array.isArray(raw.navHidden)
        ? [...new Set(raw.navHidden.filter((id): id is string => typeof id === "string"))]
        : [],
      sidebarOpen: raw.sidebarOpen === true,
      listW: typeof raw.listW === "number" ? raw.listW : 0,
      panelW: typeof raw.panelW === "number" ? raw.panelW : 0,
      boards: boardsOf(raw.boards),
      audioEndSound: raw.audioEndSound !== false,
      noticeSound:
        raw.noticeSound === "requests" || raw.noticeSound === "messages" || raw.noticeSound === "off"
          ? raw.noticeSound
          : "all",
      quotaBar: raw.quotaBar === "mini" ? "mini" : "full",
      resourcesBar: raw.resourcesBar === "mini" ? "mini" : "full",
    };
  } catch {
    return DEFAULTS;
  }
}

function idsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string"))] : [];
}

function sidebarRowsOf(raw: unknown): SidebarRows {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof SidebarRows, unknown>>;
  const rows = (n: unknown) => (typeof n === "number" && n > 0 ? Math.round(n) : 0);
  return { channels: rows(v.channels), projects: rows(v.projects), engines: rows(v.engines) };
}

/** Only well-formed boards survive a stored value written by an older (or a hand-edited) panel. */
function boardsOf(raw: unknown): Record<string, BoardPrefs> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, BoardPrefs> = {};
  for (const [id, b] of Object.entries(raw as Record<string, unknown>)) {
    const v = b as Partial<BoardPrefs> | null;
    if (!v || typeof v !== "object") continue;
    const order = Array.isArray(v.order) ? v.order.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
    const heights: Record<string, number> = {};
    if (v.heights && typeof v.heights === "object")
      for (const [k, h] of Object.entries(v.heights)) if (typeof h === "number" && h > 0) heights[k] = Math.round(h);
    const widths: Record<string, number> = {};
    if (v.widths && typeof v.widths === "object")
      for (const [k, w] of Object.entries(v.widths)) if (typeof w === "number" && w >= 1) widths[k] = Math.round(w);
    out[id] = { order: [...new Set(order)], wide: v.wide === true, heights, widths };
  }
  return out;
}

export const prefs = createStore<Prefs>(load());

/** Changes one project's board preferences, keeping the rest. */
export function setBoard(projectId: string, patch: Partial<BoardPrefs>): void {
  const boards = prefs.get().boards;
  const current = boards[projectId] ?? { order: [], wide: false, heights: {}, widths: {} };
  setPrefs({ boards: { ...boards, [projectId]: { ...current, ...patch } } });
}

export function setPrefs(patch: Partial<Prefs>): void {
  prefs.set({ ...patch, ...("textSize" in patch ? { textSize: textSizeOf(patch.textSize) } : {}) });
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs.get()));
  } catch {
    // Storage blocked: the change still applies to this session.
  }
}

/** Rows a sidebar section shows now: what the owner dragged it to, never under its minimum. */
export function useSidebarRows(section: keyof SidebarRows): number {
  const rows = usePrefs((s) => s.sidebarRows[section]);
  return Math.max(SIDEBAR_MIN_ROWS[section], rows);
}

export function setSidebarRows(section: keyof SidebarRows, rows: number): void {
  setPrefs({ sidebarRows: { ...prefs.get().sidebarRows, [section]: rows } });
}

export function usePrefs<T>(select: (s: Prefs) => T): T {
  return useSlice(prefs, select);
}

/** Most recently opened first; old and removed ids cannot grow this device preference forever. */
export function rememberSidebar(key: "projectOrder" | "engineOrder", id: string, inView?: readonly string[]): void {
  const order = prefs.get()[key];
  // One already in view keeps its place (and what is on screen is pinned as it is); one folded away comes first.
  if (inView?.includes(id)) {
    const pinned = [...inView, ...order.filter((current) => !inView.includes(current))].slice(0, 100);
    if (pinned.some((current, i) => order[i] !== current)) setPrefs({ [key]: pinned });
    return;
  }
  if (order[0] === id) return;
  setPrefs({ [key]: [id, ...order.filter((current) => current !== id)].slice(0, 100) });
}

/** "Alex Lee" → "AL", "You" → "YO", "lufer (@lufer)" → "LU": letters and digits only, a handle in brackets left out. */
export function initialsOf(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  // Only a handle: its own letters.
  const parts = words.length ? words : [name.replace(/[^\p{L}\p{N}]/gu, "")];
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return ((first[0] ?? "") + (last ? last[0] : (first[1] ?? ""))).toUpperCase() || "?";
}
