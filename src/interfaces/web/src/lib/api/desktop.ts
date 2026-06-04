import { http } from "../http";

// Desktop (floating voice window) client. Talks to the daemon's /desktop
// surface (see src/host/daemon/api/desktop.js + plugins/desktop.js).
//
// The desktop window is an Electron app spawned by the CLI (`apx desktop start`),
// NOT by the daemon — so the daemon can only report how many windows are
// currently connected over the /desktop/ws WebSocket. The web admin shows that
// status, edits persisted config (desktop.shortcut, desktop.enabled,
// desktop.theme, desktop.position), and toggles login-item autostart via the
// shared autostart helpers (core/desktop/autostart.js).

export interface DesktopStatus {
  ok: boolean;
  connected_clients: number;
  running: boolean;
}

export interface AutostartStatus {
  ok: boolean;
  enabled: boolean;
  platform: NodeJS.Platform | string;
}

export const Desktop = {
  /** GET /desktop/status — connected window count + running flag (live probe). */
  status: () => http.get<DesktopStatus>("/desktop/status"),

  /** GET /desktop/autostart — current login-item state for this platform. */
  autostartGet: () => http.get<AutostartStatus>("/desktop/autostart"),

  /** POST /desktop/autostart {enable} — toggle the login-item on or off. */
  autostartSet: (enable: boolean) =>
    http.post<AutostartStatus>("/desktop/autostart", { enable }),
};

// Last-N messages for the "desktop" global channel (preview the latest
// conversation in the web admin). Uses the unified messages-global endpoint.

export interface GlobalMessage {
  channel: string;
  direction: "in" | "out";
  type: string;
  actor_id?: string | null;
  agent_slug?: string | null;
  body: string;
  meta?: Record<string, unknown>;
  author?: string | null;
  ts: string;
}

export function fetchDesktopMessages(limit = 30) {
  return http.get<GlobalMessage[]>(`/messages/global?channel=desktop&limit=${limit}`);
}
