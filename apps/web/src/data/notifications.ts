// The attention tray (notifications.*), kept current by notification.updated events.
import type { Notification } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";

type State = { items: Record<string, Notification>; unread: number; ready: boolean };
const store = createStore<State>({ items: {}, unread: 0, ready: false });

export const useAttention = <T>(select: (s: State) => T): T => useSlice(store, select);

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The newest notices and the unread count; again after a reconnect. */
export async function loadNotifications(): Promise<void> {
  try {
    const r = await client.call("notifications.list", {});
    store.set({ items: Object.fromEntries(r.notifications.map((n) => [n.id, n])), unread: r.unread, ready: true });
  } catch (e) {
    notify(t("error.attention", { error: errText(e) }));
  }
}

type NewNoticeListener = (n: Notification) => void;
const listeners = new Set<NewNoticeListener>();

/** Called for each notice that arrives unread, or comes back with news (a later turn in the same chat). */
export function onNewNotice(listener: NewNoticeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A notification.updated event. */
export function notificationChanged(n: Notification): void {
  const prev = store.get().items[n.id];
  if (!n.read_at && (!prev || prev.created_at !== n.created_at)) for (const l of listeners) l(n);
  store.set((s) => {
    const prev = s.items[n.id];
    // A notice not in the list yet that arrives read was unread before (it is older than the page we hold).
    const was = prev ? !prev.read_at : Boolean(n.read_at);
    const delta = Number(!n.read_at) - Number(was);
    return { items: { ...s.items, [n.id]: n }, unread: Math.max(0, s.unread + delta) };
  });
}

export async function readNotifications(ids?: string[]): Promise<void> {
  // Marked here first: the events for these may arrive before or after the answer, and must not count twice.
  const at = new Date().toISOString();
  store.set((s) => ({
    items: Object.fromEntries(
      Object.entries(s.items).map(([id, n]) => [
        id,
        !n.read_at && (!ids || ids.includes(id)) ? { ...n, read_at: at } : n,
      ]),
    ),
  }));
  try {
    const r = await client.call("notifications.read", ids ? { ids } : {});
    store.set({ unread: r.unread });
  } catch (e) {
    notify(t("error.attention", { error: errText(e) }));
  }
}

/** Whether a thread has unread notices (opening it should clear them). */
export const hasNoticesFor = (threadId: string) =>
  Object.values(store.get().items).some((n) => n.thread_id === threadId && !n.read_at && n.kind !== "input");
