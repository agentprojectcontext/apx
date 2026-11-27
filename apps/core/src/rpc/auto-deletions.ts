import type { Store } from "../domain/store.ts";
import type { Handlers } from "./router.ts";

/** Auto's deletion decisions, for the owner's review (DECISIONS.md#d-281). */
export function autoDeletionHandlers(store: Store) {
  return {
    "auto_deletions.list": (p) => store.autoDeletions.page(p),
  } satisfies Partial<Handlers>;
}
