// Per-device preferences (this browser only): display name and appearance. Nothing here reaches the core.
import type { ApxLook } from "@apx/ui";
import { createStore, useSlice } from "./createStore.ts";

export type TranscriptWidth = "narrow" | "medium" | "wide";
export type UiFont = "system" | "mono";

export type Prefs = {
  /** How the panel calls you (account row, greetings). */
  displayName: string;
  look: ApxLook;
  font: UiFont;
  transcriptWidth: TranscriptWidth;
};

const KEY = "apx.prefs";
export const DEFAULT_NAME = "Vos";

const DEFAULTS: Prefs = { displayName: DEFAULT_NAME, look: "minimal", font: "system", transcriptWidth: "medium" };

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return {
      displayName:
        typeof raw.displayName === "string" && raw.displayName.trim() ? raw.displayName : DEFAULTS.displayName,
      look: raw.look === "classic" ? "classic" : "minimal",
      font: raw.font === "mono" ? "mono" : "system",
      transcriptWidth:
        raw.transcriptWidth === "narrow" || raw.transcriptWidth === "wide" ? raw.transcriptWidth : "medium",
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

/** "Alex Lee" → "AL", "Vos" → "VO". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return ((first[0] ?? "") + (last ? last[0] : (first[1] ?? ""))).toUpperCase() || "?";
}
