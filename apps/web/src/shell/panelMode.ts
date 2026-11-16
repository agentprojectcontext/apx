// Simple or advanced panel: simple keeps the super-agent's chats, reminders and channels; advanced shows everything.
import { type PanelMode, prefs, setPrefs, usePrefs } from "../data/prefs.ts";
import { type ConfigSection, go, nav } from "./nav.ts";

/** The sidebar views and sections a simple panel keeps. */
export const SIMPLE_PARTS: ReadonlySet<string> = new Set(["inbox", "routines", "channels"]);

/** Settings a simple panel leaves out: they shape projects, a team of agents or the machine APX runs on. */
const ADVANCED_CONFIG: ReadonlySet<ConfigSection> = new Set([
  "external",
  "router",
  "agents",
  "activity-review",
  "api",
  "desktop",
  "advanced",
  "storage",
  "move",
  "logs",
]);

export const usePanelMode = (): PanelMode => usePrefs((s) => s.panelMode);
export const usePanelSimple = (): boolean => usePrefs((s) => s.panelMode === "simple");

export function configShows(mode: PanelMode, section: ConfigSection): boolean {
  return mode === "advanced" || !ADVANCED_CONFIG.has(section);
}

/** Switches the panel; a screen the simple panel has no place for goes back to the Inbox. */
export function setPanelMode(mode: PanelMode): void {
  if (prefs.get().panelMode === mode) return;
  setPrefs({ panelMode: mode });
  if (mode === "advanced") return;
  const { view, config } = nav.get();
  if (!["inbox", "routines", "channels", "channel"].includes(view)) go.inbox();
  if (config && !configShows(mode, config)) go.config("account");
}
