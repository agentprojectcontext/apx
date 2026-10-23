import type { SurfaceSummary } from "@apx/protocol";
import { useSyncExternalStore } from "react";
import { dropLive } from "./livePool.ts";

// Which artifacts show in a window of their own: one copy runs at a time, so the panel shows a note where it was.

/** How often a web popup is checked for having been closed (the browser has no event for it). */
const POLL_MS = 1000;

let outside: ReadonlySet<string> = new Set();
const subs = new Set<() => void>();
const popups = new Map<string, Window>();

function mark(id: string, out: boolean): void {
  if (outside.has(id) === out) return;
  const next = new Set(outside);
  if (out) next.add(id);
  else next.delete(id);
  outside = next;
  for (const f of subs) f();
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

// The desktop app says when one of its artifact windows opens or closes, however it was closed.
window.apxDesktop?.onArtifactWindow?.((id, open) => mark(id, open));

/** The artifact alone in a window of its own: a desktop window in the app, a popup on the web. */
export function popOut(s: SurfaceSummary): void {
  // The copy running in the panel stops: the window starts from the artifact's memory.
  dropLive(s.id);
  const desktop = window.apxDesktop?.openArtifactWindow;
  if (desktop) {
    desktop(s.id, s.title);
    mark(s.id, true);
    return;
  }
  const w = window.open(
    `${window.location.origin}/?artifact=${encodeURIComponent(s.id)}`,
    `apx-artifact-${s.id}`,
    "popup,width=1200,height=820",
  );
  if (!w) return;
  popups.set(s.id, w);
  mark(s.id, true);
  const timer = setInterval(() => {
    if (!w.closed) return;
    clearInterval(timer);
    popups.delete(s.id);
    mark(s.id, false);
  }, POLL_MS);
}

/** Closes the artifact's own window; it shows in the panel again. */
export function bringBack(id: string): void {
  const close = window.apxDesktop?.closeArtifactWindow;
  if (close) close(id);
  else popups.get(id)?.close();
  mark(id, false);
}

export function useOutside(id: string): boolean {
  return useSyncExternalStore(subscribe, () => outside.has(id));
}
