// Registered public resources, never a fallback proxy into the private daemon.
import type { HookRequest, HookResponse } from "./channels/types.ts";
import type { Store } from "./domain/store.ts";
import type { PublicRoutes } from "./transport/hooks.ts";

export function nativePublicRoutes(deps: {
  store: Store;
  deliver(id: string, request: HookRequest): Promise<HookResponse>;
}): PublicRoutes {
  return (pathname) => {
    const id = /^\/hooks\/([A-Za-z0-9_-]{1,64})$/.exec(pathname)?.[1];
    if (!id) return;
    const channel = deps.store.settings.read("channels").find((c) => c.id === id);
    if (!channel || (channel.type !== "teams" && channel.type !== "line")) return;
    return {
      id: `channel:${id}`,
      methods: ["POST"],
      // These providers cannot attach an APX bearer. The adapter MUST verify its native HMAC/JWT before delivery.
      authorize: () => true,
      handle: (request) => deps.deliver(id, { ...request, path: "" }),
    };
  };
}
