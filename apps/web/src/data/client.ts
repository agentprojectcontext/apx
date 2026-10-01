import { ApxClient } from "@apx/protocol/client";

/** One HTTP client for the panel. Same origin: Vite proxies /rpc and /ws in dev, the core serves the build. */
export const client = new ApxClient({
  url: window.location.origin,
  client: { name: "apx-web", version: "0.0.0" },
});
