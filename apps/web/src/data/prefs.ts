// Per-device preferences (this browser only): display name and appearance. Nothing here reaches the core.
import type { ApxLook } from "@apx/ui";
import { defaultLanguage, isLanguage, type Language } from "../i18n/messages.ts";
import { createStore, useSlice } from "./createStore.ts";

export type TranscriptWidth = "narrow" | "medium" | "wide";
export type UiFont = "system" | "mono";

export type Prefs = {
  /** How the panel calls you (account row, greetings). Empty = not set: the UI says "You" in its language. */
  displayName: string;
  look: ApxLook;
  font: UiFont;
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
  /** How the Inbox lists chats: project → agent → chats, by time, or by project. */
  inboxView: InboxView;
  /** Columns the owner resized (px; 0 = the default) or folded away. */
  sidebarW: number;
  sidebarCollapsed: boolean;
  listW: number;
  panelW: number;
};

export type InboxView = "tree" | "activity" | "chats";

const KEY = "apx.prefs";

const DEFAULTS: Prefs = {
  displayName: "",
  look: "minimal",
  font: "system",
  transcriptWidth: "medium",
  language: defaultLanguage(),
  projectsFolded: false,
  channelsFolded: false,
  externalSessionsFolded: false,
  channelOrder: [],
  channelOrderAt: "",
  projectOrder: [],
  engineOrder: [],
  inboxView: "tree",
  sidebarW: 0,
  sidebarCollapsed: false,
  listW: 0,
  panelW: 0,
};

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return {
      displayName: typeof raw.displayName === "string" ? raw.displayName.trim() : DEFAULTS.displayName,
      look: raw.look === "classic" ? "classic" : "minimal",
      font: raw.font === "mono" ? "mono" : "system",
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
      inboxView: raw.inboxView === "activity" || raw.inboxView === "chats" ? raw.inboxView : "tree",
      sidebarW: typeof raw.sidebarW === "number" ? raw.sidebarW : 0,
      sidebarCollapsed: raw.sidebarCollapsed === true,
      listW: typeof raw.listW === "number" ? raw.listW : 0,
      panelW: typeof raw.panelW === "number" ? raw.panelW : 0,
    };
  } catch {
    return DEFAULTS;
  }
}

export const prefs = createStore<Prefs>(load());

export function setPrefs(patch: Partial<Prefs>): void {
  prefs.set(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs.get()));
  } catch {
    // Storage blocked: the change still applies to this session.
  }
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

/** "Alex Lee" → "AL", "You" → "YO". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return ((first[0] ?? "") + (last ? last[0] : (first[1] ?? ""))).toUpperCase() || "?";
}
