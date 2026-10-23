// webhooks.*: the public address channels' webhooks reach (see webhooks.ts).
import type { Webhooks } from "../webhooks.ts";
import type { Handlers } from "./router.ts";

export function webhookHandlers(webhooks: Webhooks) {
  return {
    "webhooks.get": () => webhooks.state(),
    "webhooks.set": (p) => webhooks.set(p),
  } satisfies Partial<Handlers>;
}
