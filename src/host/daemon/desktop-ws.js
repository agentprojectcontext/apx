// Singleton WebSocket hub for the desktop channel.
// Imported by api.js (to register connections) and by plugins/desktop/index.js (to broadcast).

const _clients = new Set(); // Set<WebSocket>
let _messageHandler = null; // (ws, data) => void — set by desktop plugin

export const desktopClients = _clients;

export function setDesktopMessageHandler(fn) {
  _messageHandler = fn;
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
