import { http } from "../http";

// Desktop (floating voice window) client. Talks to the daemon's /desktop
// surface (see src/host/daemon/api/desktop.js + plugins/desktop.js).
//
// The desktop window is an Electron app spawned by the CLI (`apx desktop start`),
// NOT by the daemon — so the daemon can only report how many windows are
// currently connected over the /desktop/ws WebSocket. The web admin shows that
// status and edits the persisted config (desktop.shortcut, desktop.enabled).

export interface DesktopStatus {
  ok: boolean;
  connected_clients: number;
}

export const Desktop = {
  /** GET /desktop/status — connected window count (a live "is it running" probe). */
  status: () => http.get<DesktopStatus>("/desktop/status"),
};
