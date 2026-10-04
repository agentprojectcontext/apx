// What the window opens: the first-run choice (server or client) on an installed app, then the APX it chose — its
// own core here, one at an address, or one over SSH. The panel is the same web app in every case.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { app, ipcMain, type WebContents } from "electron";
import { APP_SCHEME, FIRST_RUN_URL } from "./app-scheme.ts";
import {
  type Connection,
  forgetConnection,
  loadConnection,
  localCoreToken,
  normalizeUrl,
  saveConnection,
  validSshTarget,
} from "./connection.ts";
import { type EmbeddedCore, isUp, startEmbeddedCore, waitUp } from "./core-process.ts";
import { remoteApx, startTunnel, type Tunnel } from "./ssh-tunnel.ts";

type Answer = { ok: true } | { ok: false; reason?: string; error?: string };

export function createConnector(opts: {
  panel: WebContents;
  coreUrl: string;
  webUrl: string;
  dist: string;
  /** Whether a window asking for the core token is one of APX's own (the panel or the quick chat). */
  isOwnWindow: (sender: WebContents) => boolean;
  /** The panel loaded from this address; `node` is the core the desktop lends its browser to, when it can reach it. */
  opened: (url: string, node: { url: string; token: string | undefined } | undefined) => void;
}) {
  const dataDir = app.getPath("userData");
  const corePort = Number(new URL(opts.coreUrl).port || 7440);
  // Asked once (installed or from a checkout) and kept; APX_CONNECTION=local skips the question (tests, scripts).
  let conn: Connection | undefined =
    process.env.APX_CONNECTION === "local" ? { mode: "local" } : loadConnection(dataDir);
  let core: EmbeddedCore | undefined;
  let tunnel: Tunnel | undefined;

  const onChooser = (sender: WebContents) =>
    sender === opts.panel && sender.getURL().startsWith(`${APP_SCHEME}://app/`);

  ipcMain.on("desktop:core-token", (e) => {
    e.returnValue = conn?.mode === "local" && opts.isOwnWindow(e.sender) ? localCoreToken() : undefined;
  });

  ipcMain.handle("connect:local", async (e, access: unknown): Promise<Answer> => {
    if (!onChooser(e.sender)) return { ok: false, error: "not allowed" };
    if (access === "lan" || access === "tailscale") {
      const r = runCli(["expose", access]);
      if (!r.ok) return r;
    }
    return choose({ mode: "local" });
  });

  ipcMain.handle("connect:url", async (e, input: unknown): Promise<Answer> => {
    if (!onChooser(e.sender)) return { ok: false, error: "not allowed" };
    const url = typeof input === "string" ? normalizeUrl(input) : undefined;
    if (!url) return { ok: false, reason: "badUrl" };
    if (!(await isUp(url))) return { ok: false, reason: "notReachable" };
    return choose({ mode: "url", url });
  });

  ipcMain.handle("connect:ssh", async (e, input: unknown): Promise<Answer> => {
    if (!onChooser(e.sender)) return { ok: false, error: "not allowed" };
    if (typeof input !== "string" || !validSshTarget(input)) return { ok: false, reason: "badSsh" };
    const target = input.trim();
    const probe = startTunnel(target, corePort, () => {});
    const up = await waitUp(probe.url, 15_000);
    probe.stop();
    if (!up) {
      const remote = remoteApx(target);
      return {
        ok: false,
        reason: remote === "unreachable" ? "sshFailed" : remote === "missing" ? "sshNoApx" : "sshDown",
      };
    }
    return choose({ mode: "ssh", target });
  });

  async function choose(c: Connection): Promise<Answer> {
    saveConnection(dataDir, c);
    conn = c;
    await open();
    return { ok: true };
  }

  /** The bundled terminal (`apx2`), run on Electron's own Node like the core. */
  function runCli(args: string[]): Answer {
    const main = app.isPackaged
      ? path.join(process.resourcesPath, "apx", "apps", "terminal", "src", "main.ts")
      : path.resolve(opts.dist, "../../terminal/src/main.ts");
    const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", main, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 60_000,
      windowsHide: true,
      encoding: "utf8",
    });
    return r.status === 0
      ? { ok: true }
      : { ok: false, error: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().slice(-600) };
  }

  async function open(): Promise<void> {
    if (!conn) {
      await opts.panel.loadURL(FIRST_RUN_URL);
      return;
    }
    if (conn.mode === "local") {
      // Installed, APX starts its own core unless one already answers; a checkout tries the panel's dev server first.
      if (app.isPackaged && !core && !(await isUp(opts.coreUrl))) {
        core = startEmbeddedCore({
          resources: process.resourcesPath,
          logDir: app.getPath("logs"),
          cacheDir: path.join(dataDir, "compile-cache"),
        });
        await waitUp(opts.coreUrl);
      }
      for (const url of app.isPackaged ? [opts.coreUrl] : [opts.webUrl, opts.coreUrl]) {
        if (await load(url)) return opts.opened(url, { url: opts.coreUrl, token: localCoreToken() });
      }
      return unreachable(
        opts.coreUrl,
        app.isPackaged ? `See core.log in ${app.getPath("logs")}.` : "Start it with pnpm dev.",
      );
    }
    if (conn.mode === "url") {
      // A remote core gets this computer's browser only once the desktop pairs as a node of its own (not yet).
      if (await load(conn.url)) return opts.opened(conn.url, undefined);
      return unreachable(conn.url, "");
    }
    tunnel ??= startTunnel(conn.target, corePort, () => {});
    await waitUp(tunnel.url, 20_000);
    if (await load(tunnel.url)) return opts.opened(tunnel.url, { url: tunnel.url, token: undefined });
    return unreachable(`${conn.target} (SSH)`, "");
  }

  async function load(url: string): Promise<boolean> {
    try {
      await opts.panel.loadURL(url);
      return true;
    } catch {
      return false;
    }
  }

  async function unreachable(where: string, hint: string): Promise<void> {
    const text = `APX not reachable at ${where}. ${hint} To pick another APX: APX menu › Change connection.`;
    await opts.panel.loadURL(
      `data:text/html,<body style="font:14px system-ui;padding:24px;color:#555">${encodeURIComponent(text)}</body>`,
    );
  }

  return {
    open,
    /** Back to the first-run choice (the app starts again). */
    change(): void {
      forgetConnection(dataDir);
      app.relaunch();
      app.exit(0);
    },
    stop(): void {
      core?.stop();
      tunnel?.stop();
    },
  };
}
