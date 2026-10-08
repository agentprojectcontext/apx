// Keeps the desktop connected to the core as a node lending "browser" (and "computer" when the owner turned it on).
// Reconnects with backoff, forever; turning computer use on or off reconnects at once with the new capabilities.
import { BROWSER_CAP, COMPUTER_CAP } from "@apx/protocol";
import { ApxClient, type ApxSocket } from "@apx/protocol/client";
import type { BrowserHost } from "./browser/host.ts";

export type ComputerHandler = (method: string, params: unknown) => Promise<unknown>;

export function startNodeLink(
  host: BrowserHost,
  url: string,
  onStatus: (s: "connected" | "offline") => void,
  token?: string,
  computer?: { on(): boolean; handle: ComputerHandler },
): { refresh(): void } {
  const client = new ApxClient({
    url,
    ...(token ? { token } : {}),
    client: { name: "apx-desktop", version: "0.0.0" },
    timeoutMs: 5_000,
  });
  let socket: ApxSocket | undefined;
  let lent = false;
  host.on("changed", () => socket?.emit("browser", "tabs.changed", { tabs: host.list() }));

  const loop = async (delay: number): Promise<void> => {
    try {
      lent = Boolean(computer?.on());
      socket = await client.connect("node", lent ? [BROWSER_CAP, COMPUTER_CAP] : [BROWSER_CAP]);
      socket.onRequest((method, params) => {
        if (!method.startsWith("computer.")) return host.handle(method, params);
        // Turned off since connecting: nothing more reaches the screen.
        if (!computer?.on()) return Promise.reject(new Error("computer use is off on this computer"));
        return computer.handle(method, params);
      });
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
  return {
    /** The owner changed computer use: reconnect lending what is on now. */
    refresh() {
      if (socket && lent !== Boolean(computer?.on())) socket.close();
    },
  };
}
