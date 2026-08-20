// Singleton WebSocket hub for the desktop channel.
// Imported by api.js (to register connections) and by plugins/desktop/index.js (to broadcast).
import { apiPath } from "./api/prefix.js";

const _clients = new Set(); // Set<WebSocket>
let _messageHandler = null; // (ws, data) => void — set by desktop plugin

export const desktopClients = _clients;

export function setDesktopMessageHandler(fn) {
  _messageHandler = fn;
}

// --- WS upgrade auth ---
//
// The desktop channel authenticates the same way every other WS channel and
// every HTTP /api route does. The check itself lives in ws-auth.js — it is not
// a desktop rule, it is the daemon's rule — and only the PATH is the desktop's
// own. See that file for why it may not be duplicated per channel.

/** The desktop channel's upgrade path. Lives under /api like every other route. */
export const DESKTOP_WS_PATH = apiPath("/desktop/ws");

/** Path-gate: is this upgrade for the desktop WS channel? */
export function isDesktopUpgradePath(url) {
  let pathname = url || "";
  try { pathname = new URL(url, "http://localhost").pathname; } catch { /* keep raw */ }
  return pathname === DESKTOP_WS_PATH;
}

export function registerDesktopClient(ws) {
  _clients.add(ws);
  ws.on("close", () => _clients.delete(ws));
  ws.on("error", () => _clients.delete(ws));
  ws.on("message", (raw) => {
    if (typeof _messageHandler === "function") {
      let data;
      try { data = JSON.parse(raw.toString()); } catch { data = { type: "raw", raw: raw.toString() }; }
      _messageHandler(ws, data);
    }
  });
}

export function broadcastDesktop(msg) {
  const payload = typeof msg === "string" ? msg : JSON.stringify(msg);
  for (const ws of _clients) {
    try {
      if (ws.readyState === 1) ws.send(payload); // 1 = OPEN
    } catch {}
  }
}

export function sendToClient(ws, msg) {
  const payload = typeof msg === "string" ? msg : JSON.stringify(msg);
  try {
    if (ws.readyState === 1) ws.send(payload);
  } catch {}
}
