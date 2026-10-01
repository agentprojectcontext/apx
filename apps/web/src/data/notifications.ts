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

/** A notification.updated event. */
export function notificationChanged(n: Notification): void {
  store.set((s) => {
    const prev = s.items[n.id];
    // A notice not in the list yet that arrives read was unread before (it is older than the page we hold).
    const was = prev ? !prev.read_at : Boolean(n.read_at);
    const delta = Number(!n.read_at) - Number(was);
    return { items: { ...s.items, [n.id]: n }, unread: Math.max(0, s.unread + delta) };
  });
}

export async function readNotifications(ids?: string[]): Promise<void> {
  try {
    const r = await client.call("notifications.read", ids ? { ids } : {});
    store.set({ unread: r.unread });
  } catch (e) {
    notify(t("error.attention", { error: errText(e) }));
  }
}

export const attentionReady = () => store.get().ready;
