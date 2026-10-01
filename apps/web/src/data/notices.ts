import { createStore, useSlice } from "./createStore.ts";

export type Notice = { id: number; text: string; tone: "error" | "info" };

const notices = createStore<{ list: Notice[] }>({ list: [] });
let seq = 0;

/** Transient line at the bottom (errors by default). Auto-dismisses. */
export function notify(text: string, tone: Notice["tone"] = "error"): void {
  const id = ++seq;
  notices.set((s) => ({ list: [...s.list.slice(-2), { id, text, tone }] }));
  setTimeout(() => dismiss(id), tone === "info" ? 3000 : 6000);
}

export function dismiss(id: number): void {
  notices.set((s) => ({ list: s.list.filter((n) => n.id !== id) }));
}

export function useNotices(): Notice[] {
  return useSlice(notices, (s) => s.list);
}
