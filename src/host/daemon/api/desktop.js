// Desktop (floating voice window) HTTP surface.
//
//   GET  /desktop/status        running flag (pid) + connected websocket clients
//   POST /desktop/start         launch the floating window (detached Electron)
//   POST /desktop/stop          terminate the running window (SIGTERM)
//   POST /desktop/restart       broadcast a "reload" so live windows re-read config
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
} from "#core/desktop/autostart.js";
import {
  isDesktopRunning,
  startDesktopDetached,
  stopDesktop,
} from "#core/desktop/process.js";

export function register(app, { plugins, config }) {
  app.get("/desktop/status", (_req, res) => {
    // `running` is the live Electron process (pid file) — the source of truth
    // for the Start/Stop/Restart controls. `connected_clients` is how many of
    // those windows have an open WS to the daemon (a window can be running but
    // mid-reconnect), surfaced separately.
    const running = isDesktopRunning();
    import("../desktop-ws.js")
      .then(({ desktopClients }) => {
        res.json({ ok: true, connected_clients: desktopClients.size, running });
      })
      .catch(() => res.json({ ok: true, connected_clients: 0, running }));
  });

  // POST /desktop/start — launch the floating window (detached Electron). Same
  // helper the CLI's `apx desktop start` uses. No-op-safe if already running.
  app.post("/desktop/start", async (_req, res) => {
    try {
      const r = await startDesktopDetached({ port: config?.port });
      if (!r.ok) return res.status(500).json({ ok: false, error: r.error });
      res.json({ ok: true, pid: r.pid, already: !!r.already });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /desktop/stop — terminate the running window (SIGTERM). `stopped` is
  // false when nothing was running.
  app.post("/desktop/stop", (_req, res) => {
    const r = stopDesktop();
    if (!r.ok) return res.status(500).json({ ok: false, error: r.error });
    res.json({ ok: true, stopped: r.stopped });
  });

  // POST /desktop/restart — ask every connected desktop window to reload.
  // The web admin's "Restart" button hits this after a config change (theme,
  // position) so the floating window re-reads ~/.apx/config.json and re-applies
  // it without the user dropping to a terminal. The reload is a soft refresh of
  // the renderer (main.js repositions + reloads webContents), NOT a process
  // kill — the Electron app keeps its tray/shortcut. Returns how many windows
  // were signalled so the UI can tell "reloaded" from "nothing connected".
  app.post("/desktop/restart", (_req, res) => {
    import("../desktop-ws.js")
      .then(({ desktopClients, broadcastDesktop }) => {
        const reloaded = desktopClients.size;
        broadcastDesktop({ type: "reload" });
        res.json({ ok: true, reloaded });
      })
      .catch((e) => res.status(500).json({ ok: false, error: e.message }));
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
