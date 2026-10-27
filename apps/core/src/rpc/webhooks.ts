// webhooks.*: the public address channels' webhooks reach (see webhooks.ts).
import type { Webhooks } from "../public-tunnel.ts";
import type { Handlers } from "./router.ts";

export function webhookHandlers(webhooks: Webhooks, credentials: import("../public-credentials.ts").PublicCredentials) {
  return {
    "public_routes.list": () => ({ routes: credentials.list() }),
    "public_routes.rotate": ({ path }) => credentials.rotate(path),
    "public_routes.revoke": ({ path }) => credentials.revoke(path),
    "webhooks.get": () => webhooks.state(),
    "webhooks.set": (p) => webhooks.set(p),
  } satisfies Partial<Handlers>;
}
