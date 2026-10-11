// A newer APX: what the core says (commits on main a checkout lacks, or a newer release for a daemon installed from a
// bundle, here or on a server), what the desktop app says about itself, and whether this panel is older than the one
// the core serves now. The core updates itself and restarts; the desktop app downloads its installer and restarts.
import type { Health, Result } from "@apx/protocol";
import type { DesktopUpdate } from "../apx-desktop.d.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";

type Status = Result<"system.updates">;
type State = {
  status: Status | undefined;
  /** The desktop app's own newer version (absent in a browser). */
  app: DesktopUpdate | undefined;
  /** What the dialog updates: the core this panel talks to, the desktop app around it, or both (a core elsewhere). */
  target: "core" | "app" | "both";
  /** The core serves a newer panel than this page runs. */
  panelStale: boolean;
  /** The dialog is open (from the top bar's pill or the corner card). */
  open: boolean;
  /** ready: the desktop app downloaded the newer one, which goes in when it restarts (now or later). */
  phase: "idle" | "updating" | "ready" | "restarting" | "done" | "failed";
  log: string;
};
const store = createStore<State>({
  status: undefined,
  app: undefined,
  target: "core",
  panelStale: false,
  open: false,
  phase: "idle",
  log: "",
});
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

const QUICK = new URLSearchParams(window.location.search).has("quick");
const RECHECK_MS = 30_000;
let checkedAt = 0;

/**
 * Asks again whether the panel on disk changed when the window is shown or put away, so a new build shows up without
 * waiting. The quick window has no top bar to offer it, so it loads the new panel itself then.
 */
async function recheckPanel(): Promise<void> {
  if (Date.now() - checkedAt < RECHECK_MS && !store.get().panelStale) return;
  checkedAt = Date.now();
  try {
    notePanel(await client.call("system.health", {}));
  } catch {
    return;
  }
  if (QUICK && store.get().panelStale) window.location.reload();
}
window.addEventListener("focus", () => void recheckPanel());
document.addEventListener("visibilitychange", () => void recheckPanel());

/** Asks the desktop app (when there is one) whether a newer one is out. */
async function loadApp(check: boolean): Promise<void> {
  const app = await window.apxDesktop?.updateStatus?.(check).catch(() => undefined);
  if (app) store.set({ app });
}
// Started from the app menu, or found by the app's own check: the pill and the card follow it.
window.apxDesktop?.onUpdateStatus?.((app) => store.set({ app }));

export async function loadUpdates(check = false): Promise<void> {
  void loadApp(check);
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
  if (store.get().target === "app") return applyAppUpdate();
  if (store.get().target === "both") return applyBoth();
  try {
    const r = await client.call("system.update", {});
    store.set({ phase: r.ok ? (r.restart ? "restarting" : "done") : "failed", log: r.log });
  } catch (e) {
    store.set({ phase: "failed", log: e instanceof Error ? e.message : String(e) });
  }
}

async function applyAppUpdate(): Promise<void> {
  const r = await window.apxDesktop?.installUpdate?.().catch((e: unknown) => ({
    ok: false as const,
    error: e instanceof Error ? e.message : String(e),
  }));
  if (!r) store.set({ phase: "failed", log: "" });
  else if (!r.ok) store.set({ phase: "failed", log: r.error });
  // Ready: it goes in when the app restarts. Otherwise (a disk image) the owner drags it in.
  else store.set({ phase: r.ready ? "ready" : "done" });
}

/** The server first, then this app: the app restarts last, and its new panel talks to a core already up to date. */
async function applyBoth(): Promise<void> {
  try {
    const r = await client.call("system.update", {});
    if (!r.ok) return store.set({ phase: "failed", log: r.log });
    if (r.restart) await coreBack();
  } catch (e) {
    return store.set({ phase: "failed", log: e instanceof Error ? e.message : String(e) });
  }
  await applyAppUpdate();
}

/** Waits for a core that restarts after updating to answer again (two minutes at most). */
async function coreBack(): Promise<void> {
  const until = Date.now() + 120_000;
  await new Promise((r) => setTimeout(r, 1500));
  while (Date.now() < until) {
    try {
      await client.call("system.health", {});
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** The desktop app quits and opens the newer one it has ready. */
export function restartApp(): void {
  store.set({ phase: "restarting" });
  window.apxDesktop?.restartToUpdate?.();
}

/**
 * What is newer, if anything: the desktop app first (it carries its own core), then the core. With a core elsewhere
 * (a server over SSH or at an address) both may be: one card and one update for the two.
 */
export function newerOf(
  status: Status | undefined,
  app: DesktopUpdate | undefined,
  coreElsewhere = window.apxDesktop?.coreLocal === false,
): { target: State["target"]; version?: string } | undefined {
  const appVersion = app?.ready ?? app?.latest;
  if (appVersion && status?.behind && coreElsewhere) return { target: "both", version: appVersion };
  if (appVersion) return { target: "app", version: appVersion };
  if (status?.behind) return { target: "core", version: status.source === "release" ? status.latest : undefined };
  return undefined;
}

/** Opens the dialog on what is newer; a desktop app that already has it downloaded only asks when to restart. */
export const openUpdate = (target: State["target"]) =>
  store.set((s) => ({ target, open: true, phase: target === "app" && s.app?.ready ? "ready" : "idle", log: "" }));

export const closeUpdate = () => store.set({ open: false, phase: "idle", log: "" });
