// Desktop (floating voice window) HTTP surface.
//
//   GET  /desktop/status     connected websocket clients count
//   POST /desktop/message    text (post-STT). Responds 200 immediately;
//                            the super-agent answer is streamed back over WS
//                            by the desktop plugin.
export function register(app, { plugins }) {
  app.get("/desktop/status", (_req, res) => {
    import("../desktop-ws.js")
      .then(({ desktopClients }) => {
        res.json({ ok: true, connected_clients: desktopClients.size });
      })
      .catch(() => res.json({ ok: true, connected_clients: 0 }));
  });

  app.post("/desktop/message", async (req, res) => {
    const { text, previousMessages = [] } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    // Respond immediately — the real reply goes over WebSocket.
    res.json({ ok: true });

    try {
      const desktopPlugin = plugins.instances.get("desktop");
      if (desktopPlugin?.handleMessage) {
        await desktopPlugin.handleMessage({ text, previousMessages });
      }
    } catch (e) {
      import("../desktop-ws.js")
        .then(({ broadcastDesktop }) => {
          broadcastDesktop({ type: "error", message: e.message });
        })
        .catch(() => {});
    }
  });
}
