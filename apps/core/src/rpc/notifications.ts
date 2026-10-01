// The attention tray, for the owner.
import type { Store } from "../domain/store.ts";
import type { Handlers } from "./router.ts";

export function notificationHandlers(store: Store) {
  return {
    "notifications.list": ({ unread_only, limit }) => ({
      notifications: store.notifications.list({ unreadOnly: unread_only, limit }),
      unread: store.notifications.unread(),
    }),
    "notifications.read": ({ ids }) => {
      store.notifications.read(ids);
      return { unread: store.notifications.unread() };
    },
  } satisfies Partial<Handlers>;
}
