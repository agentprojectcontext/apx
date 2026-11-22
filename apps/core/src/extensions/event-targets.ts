import type { Store } from "../domain/store.ts";
import { audienceOf } from "../engine/audience.ts";
import { badRequest } from "../errors.ts";

export function extensionEventTarget(store: Store, thread: string) {
  const t = store.threads.get(thread);
  if (!t || t.archived || !["loose", "agent", "home"].includes(t.kind) || audienceOf(store, t).kind !== "owner")
    throw badRequest("Choose an unarchived personal chat for extension notices");
  return t;
}
export function extensionEventTargets(store: Store) {
  return store.threads.list({ limit: 100 }).flatMap((t) => {
    try {
      extensionEventTarget(store, t.id);
      return [{ id: t.id, title: t.title }];
    } catch {
      return [];
    }
  });
}
