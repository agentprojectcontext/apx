// Registered public resources, never a fallback proxy into the private daemon.
import type { HookRequest, HookResponse } from "./channels/types.ts";
import type { Store } from "./domain/store.ts";
import { storedPublicPages, surfacePage } from "./surface-pages.ts";
import type { PublicRoutes } from "./transport/hooks.ts";

export function publishedPublicRoutes(store: Store): PublicRoutes {
  const pages = storedPublicPages(store);
  return (pathname) => {
    const token = /^\/a\/([a-f0-9]{32})$/.exec(pathname)?.[1];
    const kit = /^\/_apx\/kit@1(?:\.\d+){0,2}\.js$/.test(pathname);
    const surface = token ? store.surfaces.byShareToken(token) : undefined;
    if (!kit && !surface) return;
    return {
      id: surface ? `surface:${surface.id}` : "surface-kit",
      methods: ["GET", "HEAD"],
      authorize: () => true,
      handle: async (request) => {
        const response = surfacePage(pathname, pages, true) ?? { status: 404 };
        return request.method === "HEAD" ? { ...response, body: undefined } : response;
      },
    };
  };
}

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
