// Simple or advanced panel: simple is everything but projects and the CLIs' sessions, with fewer settings.

import { client } from "../data/client.ts";
import { type PanelMode, prefs, setPrefs, usePrefs } from "../data/prefs.ts";
import { type ConfigSection, go, nav } from "./nav.ts";

/** What a simple panel has no place for: projects, the coding CLIs' sessions, the isolated computers. */
export const SIMPLE_GONE: ReadonlySet<string> = new Set(["projects", "sessions", "computers"]);
/** Views a simple panel leaves off until the owner turns them on from the sidebar's menu. */
export const SIMPLE_OFF: ReadonlySet<string> = new Set(["flows"]);

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

/** Reads the core's word on the mode (every panel shows the same; the super-agent may switch it). */
export async function loadPanelMode(): Promise<void> {
  try {
    shown((await client.call("panel.mode", {})).mode);
  } catch {
    // An older core has no mode: the panel keeps what it showed.
  }
}

/** Switches every panel of this APX; this one at once. */
export function setPanelMode(mode: PanelMode): void {
  shown(mode);
  void client.call("panel.set_mode", { mode }).catch(() => {});
}

/** Shows a mode (the core's, told live); a screen the simple panel has no place for goes back to the Inbox. */
export function shown(mode: PanelMode): void {
  if (prefs.get().panelMode === mode) return;
  setPrefs({ panelMode: mode });
  if (mode === "advanced") return;
  const { view, config } = nav.get();
  if (view === "project" || view === "engine" || view === "computers") go.inbox();
  if (config && !configShows(mode, config)) go.config("account");
}
