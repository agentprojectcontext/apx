// Desktop (floating voice window) HTTP surface.
//
//   GET  /desktop/status        connected websocket clients count
//   POST /desktop/message       text (post-STT). Responds 200 immediately;
//                               the super-agent answer is streamed back over WS
//                               by the desktop plugin.
//   GET  /desktop/autostart     { enabled, platform }
//   POST /desktop/autostart     { enable: boolean } → { ok, enabled, ... }
//
// Autostart endpoints run the SAME helpers the CLI's
// `apx desktop install/uninstall` use (core/desktop/autostart.js), so the
// web admin toggle is interchangeable with the CLI command.

import {
  autostartIsOn,
  autostartInstall,
  autostartUninstall,
} from "../../../core/desktop/autostart.js";

export function register(app, { plugins }) {
  app.get("/desktop/status", (_req, res) => {
    import("../desktop-ws.js")
      .then(({ desktopClients }) => {
        res.json({
          ok: true,
          connected_clients: desktopClients.size,
          running: desktopClients.size > 0,
        });
      })
      .catch(() => res.json({ ok: true, connected_clients: 0, running: false }));
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

  // ── Autostart-at-login (per-user, no sudo) ──────────────────────────────
  // Reads/toggles the same launchd plist / Windows Run / .desktop entry the
  // `apx desktop install/uninstall` CLI commands manage. Web admin uses
  // these so the user can flip the setting without dropping to a terminal.

  app.get("/desktop/autostart", (_req, res) => {
    res.json({ ok: true, enabled: autostartIsOn(), platform: process.platform });
  });

  app.post("/desktop/autostart", (req, res) => {
    const { enable } = req.body || {};
    if (typeof enable !== "boolean") {
      return res.status(400).json({ ok: false, error: "body.enable must be a boolean" });
    }
    const r = enable ? autostartInstall() : autostartUninstall();
    if (!r.ok) return res.status(500).json({ ok: false, error: r.error });
    res.json({ ok: true, enabled: autostartIsOn(), ...r });
  });
}
