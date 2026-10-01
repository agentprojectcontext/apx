// Outside apps, for the owner: connect one (its token is shown once), list them, cut one off.
import type { Store } from "../domain/store.ts";
import type { Handlers } from "./router.ts";

export function clientHandlers(store: Store) {
  return {
    "clients.list": () => ({ clients: store.clients.list() }),
    "clients.create": ({ name, scopes }) => store.clients.create(name, scopes),
    "clients.revoke": ({ id }) => ({ revoked: store.clients.revoke(id) }),
  } satisfies Partial<Handlers>;
}
