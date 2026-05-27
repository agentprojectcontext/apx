// Overlay (floating voice window) HTTP surface.
//
//   GET  /overlay/status     connected websocket clients count
//   POST /overlay/message    text (post-STT). Responds 200 immediately;
//                            the super-agent answer is streamed back over WS
//                            by the overlay plugin.
export function register(app, { plugins }) {
  app.get("/overlay/status", (_req, res) => {
    import("../overlay-ws.js")
      .then(({ overlayClients }) => {
        res.json({ ok: true, connected_clients: overlayClients.size });
      })
      .catch(() => res.json({ ok: true, connected_clients: 0 }));
  });

  app.post("/overlay/message", async (req, res) => {
    const { text, previousMessages = [] } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    // Respond immediately — the real reply goes over WebSocket.
    res.json({ ok: true });

    try {
      const overlayPlugin = plugins.instances.get("overlay");
      if (overlayPlugin?.handleMessage) {
        await overlayPlugin.handleMessage({ text, previousMessages });
      }
    } catch (e) {
      import("../overlay-ws.js")
        .then(({ broadcastOverlay }) => {
          broadcastOverlay({ type: "error", message: e.message });
        })
        .catch(() => {});
    }
  });
}
