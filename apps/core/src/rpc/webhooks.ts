// Owner-only management of the shared public tunnel and independently revocable endpoint credentials.
import type { PublicTunnel } from "../public-tunnel.ts";
import type { Handlers } from "./router.ts";

export function webhookHandlers(
  webhooks: PublicTunnel,
  credentials: import("../public-credentials.ts").PublicCredentials,
) {
  return {
    "public_routes.list": () => ({ routes: credentials.list() }),
    "public_routes.rotate": ({ path }) => credentials.rotate(path),
    "public_routes.revoke": ({ path }) => credentials.revoke(path),
    "webhooks.get": () => webhooks.state(),
    "webhooks.set": (p) => webhooks.set(p),
  } satisfies Partial<Handlers>;
}
