import { contactSources } from "../domain/contact-sources.ts";
import type { Store } from "../domain/store.ts";
import type { Handlers } from "./router.ts";

export function contactSourceHandlers(store: Store) {
  const sources = contactSources(store);
  return {
    "contacts.sources.list": ({ person }) => ({ sources: sources.list(person) }),
    "contacts.sources.set": (params) => sources.set(params),
    "contacts.sources.remove": ({ id }) => ({ removed: sources.remove(id) }),
    "contacts.source_updates.list": ({ person }) => ({ updates: sources.updates(person) }),
    "contacts.source_updates.resolve": ({ id, accept }) => sources.resolve(id, accept),
  } satisfies Pick<
    Handlers,
    | "contacts.sources.list"
    | "contacts.sources.set"
    | "contacts.sources.remove"
    | "contacts.source_updates.list"
    | "contacts.source_updates.resolve"
  >;
}
