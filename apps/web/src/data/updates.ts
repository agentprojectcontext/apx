// A newer APX: what the core says about the checkout (commits on main it lacks) and whether this panel is older than
// the one the core serves now. Updating runs in the core; after it restarts, the panel reloads itself.
import type { Health, Result } from "@apx/protocol";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";

type Status = Result<"system.updates">;
type State = {
  status: Status | undefined;
  /** The core serves a newer panel than this page runs. */
  panelStale: boolean;
  phase: "idle" | "updating" | "restarting" | "done" | "failed";
  log: string;
};
const store = createStore<State>({ status: undefined, panelStale: false, phase: "idle", log: "" });
export const useUpdates = <T>(select: (s: State) => T): T => useSlice(store, select);

// Both answers are read from the core's memory (it asks git on its own schedule): cheap to ask often.
const CHECK_EVERY_MS = 10 * 60_000;
let timer: ReturnType<typeof setInterval> | undefined;

/** This page's own build: its entry script, as index.html named it. */
function ownEntry(): string | undefined {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.src;
  return src?.split("/").pop();
}

/** Called with each health answer: a different entry means the panel on disk changed. */
export function notePanel(health: Health): void {
  const own = ownEntry();
  if (!own || !health.panel) return;
  if (store.get().phase === "restarting") {
    // The core is back with the new code: load the new panel.
    window.location.reload();
    return;
  }
  store.set({ panelStale: health.panel !== own });
}

export async function loadUpdates(check = false): Promise<void> {
  try {
    const [status, health] = await Promise.all([
      client.call("system.updates", { check }),
      client.call("system.health", {}),
    ]);
    store.set({ status });
    notePanel(health);
  } catch {
    // An older core, or offline: nothing to show.
  }
  if (!timer) timer = setInterval(() => void loadUpdates(), CHECK_EVERY_MS);
}

export async function applyUpdate(): Promise<void> {
  store.set({ phase: "updating", log: "" });
  try {
    const r = await client.call("system.update", {});
    store.set({ phase: r.ok ? (r.restart ? "restarting" : "done") : "failed", log: r.log });
  } catch (e) {
    store.set({ phase: "failed", log: e instanceof Error ? e.message : String(e) });
  }
}

export const resetUpdate = () => store.set({ phase: "idle", log: "" });
