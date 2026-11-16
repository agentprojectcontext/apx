// How the owner uses APX: simple (an assistant for their day, without projects) or advanced (projects and a team).
// Saved in the core so every panel shows the same and the super-agent knows which one the owner sees.
import type { PanelMode } from "@apx/protocol";
import type { Store } from "./store.ts";

const KEY = "panel_mode";

/** Advanced until a setup or the owner says simple: installs from before simple existed keep their whole panel. */
export const panelMode = (store: Store): PanelMode => (store.settings.get(KEY) === "simple" ? "simple" : "advanced");

export function setPanelMode(store: Store, mode: PanelMode): PanelMode {
  store.settings.set(KEY, mode);
  return mode;
}
