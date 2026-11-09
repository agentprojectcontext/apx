// The owner hears about notes agents learned about them in the app's tray: one notice while any waits.
import type { Memory } from "@apx/protocol";
import type { Store } from "./store.ts";

const REF = "pending";
const TOLD_AT_START = "memory_pending_told";

const waiting = (store: Store) => store.memories.list({ scope: "global", pending: true, limit: 1 });

/** A note about the owner now waits: the tray's notice says so, with the newest one. */
export function noteWaits(store: Store, note: Memory): void {
  if (!note.pending || note.scope !== "global") return;
  store.notifications.add({
    kind: "memory",
    title: (note.author_agent && store.agents.get(note.author_agent)?.name) || "APX",
    body: note.text.length > 200 ? `${note.text.slice(0, 199)}…` : note.text,
    ref: REF,
  });
}

/** None waits any more (confirmed, edited or forgotten): the notice goes. */
export function notesSettled(store: Store): void {
  if (!waiting(store).length) store.notifications.resolve("memory", REF);
}

/** Notes that waited before the tray told about them are told once, on the first start that can. */
export function tellWaitingNotes(store: Store): void {
  if (store.settings.get(TOLD_AT_START)) return;
  const newest = waiting(store)[0];
  if (newest) noteWaits(store, newest);
  store.settings.set(TOLD_AT_START, new Date().toISOString());
}
