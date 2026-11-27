import type { Store } from "../domain/store.ts";
import type { Handlers } from "./router.ts";

/** Auto's deletion decisions, for the owner's review (DECISIONS.md#d-281). */
export function autoDecisionHandlers(store: Store) {
  return {
    "auto_decisions.list": (p) => store.autoDecisions.page(p),
  } satisfies Partial<Handlers>;
}
