// Singleton WebSocket hub for the overlay channel.
// Imported by api.js (to register connections) and by plugins/overlay.js (to broadcast).

const _clients = new Set(); // Set<WebSocket>
let _messageHandler = null; // (ws, data) => void — set by overlay plugin

export const overlayClients = _clients;

export function setOverlayMessageHandler(fn) {
  _messageHandler = fn;
}

export function registerOverlayClient(ws) {
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

export function broadcastOverlay(msg) {
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
