// The desktop app's install from a browser panel on this computer: one state for the sidebar's launcher and the
// notice that offers it, polled while the launcher is mounted.
import type { DesktopInstallStatus } from "@apx/protocol";
import { useEffect } from "react";
import { client, keyStore } from "../data/client.ts";
import { createStore, useSlice } from "../data/createStore.ts";

type InstallError = { lost: true } | { message: string };
type State = {
  status?: DesktopInstallStatus;
  dismissed: boolean;
  starting: boolean;
  cancelling: boolean;
  error?: InstallError;
};

const DISMISSED = "apx.desktop-install.dismissed";

export const localBrowser = () =>
  !window.apxDesktop &&
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) &&
  !/Android|iPhone|iPad/i.test(navigator.userAgent);
export const busy = (s?: DesktopInstallStatus) =>
  Boolean(s && ["downloading", "installing", "opening"].includes(s.phase));

function readDismissed(): boolean {
  try {
    return keyStore()?.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

const store = createStore<State>({ dismissed: readDismissed(), starting: false, cancelling: false });
export const useDesktopInstall = <T>(select: (s: State) => T): T => useSlice(store, select);

// A newer request makes the answers of older ones stale.
let revision = 0;
let submitting: { request: number; kind: "install" | "cancel" } | undefined;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let watchers = 0;

const messageOf = (e: unknown): InstallError => ({ message: e instanceof Error ? e.message : String(e) });

/** Reads the status now and again while it is busy; a lost connection retries with a growing wait. */
function poll(): void {
  const gen = ++generation;
  if (timer) clearTimeout(timer);
  let failures = 0;
  const load = async () => {
    const request = revision;
    try {
      const next = await client.call("desktop.install_status", {});
      if (gen !== generation || request !== revision) return;
      failures = 0;
      store.set({ status: next, error: undefined });
      if (busy(next)) timer = setTimeout(() => void load(), 500);
    } catch {
      if (gen !== generation || request !== revision || submitting) return;
      failures++;
      store.set({ error: { lost: true } });
      timer = setTimeout(() => void load(), Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
    }
  };
  void load();
}

/** Keeps the status fresh while mounted (the sidebar's launcher). */
export function useDesktopInstallWatch(): void {
  useEffect(() => {
    if (!localBrowser()) return;
    watchers++;
    if (watchers === 1) poll();
    return () => {
      watchers--;
      if (watchers > 0) return;
      generation++;
      if (timer) clearTimeout(timer);
    };
  }, []);
}

export function dismissDesktopInstall(closed: boolean): void {
  store.set({ dismissed: closed });
  try {
    if (closed) keyStore()?.setItem(DISMISSED, "1");
    else keyStore()?.removeItem(DISMISSED);
  } catch {
    // Storage restrictions do not prevent this session from closing the notice.
  }
}

export async function installDesktop(): Promise<void> {
  if (submitting) return;
  const now = store.get();
  // Busy and cut off: only check again.
  if (busy(now.status) && now.error) {
    revision++;
    store.set({ error: undefined });
    poll();
    return;
  }
  dismissDesktopInstall(false);
  const request = ++revision;
  submitting = { request, kind: "install" };
  store.set({
    starting: true,
    error: undefined,
    status: now.status ? { ...now.status, phase: "downloading", error: undefined } : now.status,
  });
  try {
    const next = await client.call("desktop.install", {});
    if (request === revision) {
      store.set({ status: next });
      poll();
    }
  } catch (e) {
    if (request === revision) store.set({ error: messageOf(e) });
  } finally {
    if (submitting?.request === request) submitting = undefined;
    if (request === revision) store.set({ starting: false });
  }
}

export async function cancelDesktopInstall(): Promise<void> {
  const now = store.get();
  if (now.starting || submitting?.kind === "cancel" || now.status?.phase !== "downloading") return;
  const request = ++revision;
  submitting = { request, kind: "cancel" };
  store.set({ cancelling: true, error: undefined });
  try {
    const next = await client.call("desktop.install_cancel", {});
    if (request === revision) store.set({ status: next });
  } catch (e) {
    if (request === revision) store.set({ error: messageOf(e) });
  } finally {
    if (submitting?.request === request) submitting = undefined;
    if (request === revision) {
      store.set({ cancelling: false, starting: false });
      poll();
    }
  }
}
