// Keeps the desktop connected to the core as a node lending "browser". Reconnects with backoff, forever.
import { BROWSER_CAP } from "@apx/protocol";
import { ApxClient, type ApxSocket } from "@apx/protocol/client";
import type { BrowserHost } from "./browser/host.ts";

export function startNodeLink(
  host: BrowserHost,
  url: string,
  onStatus: (s: "connected" | "offline") => void,
  token?: string,
): void {
  const client = new ApxClient({
    url,
    ...(token ? { token } : {}),
    client: { name: "apx-desktop", version: "0.0.0" },
    timeoutMs: 5_000,
  });
  let socket: ApxSocket | undefined;
  host.on("changed", () => socket?.emit("browser", "tabs.changed", { tabs: host.list() }));

  const loop = async (delay: number): Promise<void> => {
    try {
      socket = await client.connect("node", [BROWSER_CAP]);
      socket.onRequest((method, params) => host.handle(method, params));
      onStatus("connected");
      delay = 500;
      await socket.closed;
    } catch {
      // core not up yet
    }
    socket = undefined;
    onStatus("offline");
    setTimeout(() => void loop(Math.min(delay * 2, 10_000)), delay);
  };
  void loop(500);
}
