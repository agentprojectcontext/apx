// Keeps the desktop connected to the core as a node lending "browser" (and "computer" when the owner turned it on).
// Reconnects with backoff, forever; turning computer use on or off reconnects at once with the new capabilities.
import { BROWSER_CAP, COMPUTER_CAP } from "@apx/protocol";
import { ApxClient, type ApxSocket } from "@apx/protocol/client";
import type { BrowserHost } from "./browser/host.ts";

export type ComputerHandler = (method: string, params: unknown) => Promise<unknown>;
type NodeSocket = Pick<ApxSocket, "onRequest" | "emit" | "close" | "closed">;
type NodeHost = Pick<BrowserHost, "list" | "handle" | "dropHolds"> & {
  on(event: "changed", listener: () => void): unknown;
  off(event: "changed", listener: () => void): unknown;
};

export function startNodeLink(
  host: NodeHost,
  url: string,
  onStatus: (s: "connected" | "offline") => void,
  token?: string,
  computer?: { on(): boolean; handle: ComputerHandler },
  connect?: (caps: string[], signal: AbortSignal) => Promise<NodeSocket>,
): { refresh(): void; emit(type: string, payload?: unknown): void; stop(): void } {
  const controller = new AbortController();
  const client = new ApxClient({
    url,
    ...(token ? { token } : {}),
    client: { name: "apx-desktop", version: "0.0.0" },
    timeoutMs: 5_000,
    signal: controller.signal,
  });
  const open = connect ?? ((caps: string[]) => client.connect("node", caps));
  let socket: NodeSocket | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lent = false;
  const changed = () => socket?.emit("browser", "tabs.changed", { tabs: host.list() });
  host.on("changed", changed);

  const loop = async (delay: number): Promise<void> => {
    if (stopped) return;
    try {
      lent = Boolean(computer?.on());
      const opened = await open(lent ? [BROWSER_CAP, COMPUTER_CAP] : [BROWSER_CAP], controller.signal);
      if (stopped) {
        opened.close();
        return;
      }
      socket = opened;
      socket.onRequest((method, params) => {
        if (stopped) return Promise.reject(new Error("desktop connection ended"));
        if (!method.startsWith("computer.")) return host.handle(method, params);
        // Turned off since connecting: nothing more reaches the screen.
        if (!computer?.on()) return Promise.reject(new Error("computer use is off on this computer"));
        return computer.handle(method, params);
      });
      onStatus("connected");
      delay = 500;
      // The owner's choice may have arrived while connecting: lend what is on now.
      if (lent !== Boolean(computer?.on())) socket.close();
      await socket.closed;
    } catch {
      // core not up yet
    }
    if (stopped) return;
    socket = undefined;
    host.dropHolds();
    onStatus("offline");
    timer = setTimeout(() => void loop(Math.min(delay * 2, 10_000)), delay);
  };
  void loop(500);
  return {
    /** The owner changed computer use: reconnect lending what is on now. */
    refresh() {
      if (socket && lent !== Boolean(computer?.on())) socket.close();
    },
    /** An event for the core about what this node lends (the emergency stop). */
    emit(type, payload = {}) {
      socket?.emit("computer", type, payload);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      host.off("changed", changed);
      socket?.close();
      socket = undefined;
      host.dropHolds();
      onStatus("offline");
    },
  };
}
