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
  /** How the Inbox lists chats: project → agent → chats, by time, or by project. */
  inboxView: InboxView;
  /** Columns the owner resized (px; 0 = the default) or folded away. */
  sidebarW: number;
  sidebarCollapsed: boolean;
  listW: number;
  listCollapsed: boolean;
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
  inboxView: "tree",
  sidebarW: 0,
  sidebarCollapsed: false,
  listW: 0,
  listCollapsed: false,
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
      inboxView: raw.inboxView === "activity" || raw.inboxView === "chats" ? raw.inboxView : "tree",
      sidebarW: typeof raw.sidebarW === "number" ? raw.sidebarW : 0,
      sidebarCollapsed: raw.sidebarCollapsed === true,
      listW: typeof raw.listW === "number" ? raw.listW : 0,
      listCollapsed: raw.listCollapsed === true,
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

/** "Alex Lee" → "AL", "You" → "YO". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return ((first[0] ?? "") + (last ? last[0] : (first[1] ?? ""))).toUpperCase() || "?";
}
