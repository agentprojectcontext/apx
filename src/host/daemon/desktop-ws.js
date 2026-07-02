// Singleton WebSocket hub for the desktop channel.
// Imported by api.js (to register connections) and by plugins/desktop/index.js (to broadcast).

const _clients = new Set(); // Set<WebSocket>
let _messageHandler = null; // (ws, data) => void — set by desktop plugin

export const desktopClients = _clients;

export function setDesktopMessageHandler(fn) {
  _messageHandler = fn;
}

// --- WS upgrade auth helpers (shared by the daemon upgrade handler + tests) ---
//
// The desktop WS channel must authenticate the same way the HTTP /desktop/*
// routes do: a bearer token (master or paired client) carried on the upgrade
// request. The legitimate desktop window sends `Authorization: Bearer <token>`
// (src/interfaces/desktop/main.js); browser clients can pass `?token=`. Without
// this, any client that can reach the daemon (loopback by default, but the LAN
// when host is set to 0.0.0.0) could open the channel and drive the
// super-agent. See QA BUG-WS-AUTH.

/** Path-gate: is this upgrade for the desktop (or legacy overlay) WS channel? */
export function isDesktopUpgradePath(url) {
  let pathname = url || "";
  try { pathname = new URL(url, "http://localhost").pathname; } catch { /* keep raw */ }
  return pathname === "/desktop/ws" || pathname === "/overlay/ws";
}

/** Extract the bearer token from the upgrade request (header first, ?token= fallback). */
export function extractWsToken(req) {
  const auth = (req && req.headers && req.headers["authorization"]) || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  try {
    return new URL((req && req.url) || "", "http://localhost").searchParams.get("token") || "";
  } catch { return ""; }
}

/** True iff the upgrade request carries a token the store recognizes. */
export function isDesktopUpgradeAuthorized(req, tokenStore) {
  if (!tokenStore || typeof tokenStore.has !== "function") return false;
  return tokenStore.has(extractWsToken(req));
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
