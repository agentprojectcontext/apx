// What the window opens: the first-run choice (server or client) on an installed app, then the APX it chose — its
// own core here, one at an address, or one over SSH. The panel is the same web app in every case.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
import { installArgs, remoteApx, remoteInstall, remoteLinger, startTunnel, type Tunnel } from "./ssh-tunnel.ts";

// ready: installed on a server and reachable, but not opened yet (the screen says so first); linger names the user
// whose services stop at logout until they linger.
type Answer = { ok: true; ready?: true; linger?: string } | { ok: false; reason?: string; error?: string };

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

  ipcMain.on("desktop:core-local", (e) => {
    e.returnValue = conn?.mode === "local" && opts.isOwnWindow(e.sender);
  });

  ipcMain.handle("connect:local", async (e, access: unknown): Promise<Answer> => {
    if (!onChooser(e.sender)) return { ok: false, error: "not allowed" };
    if (access !== "none" && access !== "lan" && access !== "tailscale") return { ok: false, error: "bad access" };
    // "Only this computer" undoes an earlier LAN or Tailscale choice too.
    const r = runCli(["expose", access === "none" ? "off" : access]);
    if (!r.ok) return r;
    await restartOwnCore();
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
    step(e.sender, "ssh");
    if (!(await sshCoreUp(target))) {
      step(e.sender, "probe");
      const remote = remoteApx(target);
      return {
        ok: false,
        reason: remote === "unreachable" ? "sshFailed" : remote === "missing" ? "sshNoApx" : "sshDown",
      };
    }
    return choose({ mode: "ssh", target });
  });

  // The server has no APX: this app installs its own version there (install.sh over ssh), then connects.
  ipcMain.handle("connect:ssh-install", async (e, input: unknown): Promise<Answer> => {
    if (!onChooser(e.sender)) return { ok: false, error: "not allowed" };
    if (typeof input !== "string" || !validSshTarget(input)) return { ok: false, reason: "badSsh" };
    const target = input.trim();
    const script = fs.readFileSync(installScript(), "utf8");
    const args = installArgs(app.getVersion(), process.env.APX_RELEASES);
    step(e.sender, "install");
    const r = await remoteInstall(target, script, args, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send("connect:progress", line);
    });
    if (!r.ok) return r;
    step(e.sender, "connect");
    if (!(await sshCoreUp(target, 30_000))) return { ok: false, reason: "sshDown" };
    // Installed: the screen says so before the server's own setup opens (connect:ssh, once the owner goes on).
    return r.lingers ? { ok: true, ready: true } : { ok: true, ready: true, linger: r.user };
  });

  // Keeping the server's APX up after this app disconnects takes root: sudo, with the password the owner types now.
  ipcMain.handle("connect:ssh-linger", async (e, input: unknown, password: unknown): Promise<Answer> => {
    if (!onChooser(e.sender)) return { ok: false, error: "not allowed" };
    if (typeof input !== "string" || !validSshTarget(input) || typeof password !== "string")
      return { ok: false, reason: "badSsh" };
    return (await remoteLinger(input.trim(), password)) ? { ok: true } : { ok: false, reason: "sudoFailed" };
  });

  /** Tells the first-run screen which step it is waiting on. */
  function step(sender: WebContents, id: "ssh" | "probe" | "install" | "connect"): void {
    if (!sender.isDestroyed()) sender.send("connect:step", id);
  }

  async function sshCoreUp(target: string, wait = 15_000): Promise<boolean> {
    const probe = startTunnel(target, corePort, () => {});
    const up = await waitUp(probe.url, wait);
    probe.stop();
    return up;
  }

  /** install.sh as this build carries it (the stage copies it next to the core; a checkout has it in scripts/). */
  function installScript(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, "apx", "scripts", "install", "install.sh")
      : path.resolve(opts.dist, "../../../scripts/install/install.sh");
  }

  /** The bundled core reads core.env when it starts: after an exposure change it starts again (a checkout's is not ours). */
  async function restartOwnCore(): Promise<void> {
    if (!core) return;
    core.stop();
    core = undefined;
    const until = Date.now() + 10_000;
    while (Date.now() < until && (await isUp(opts.coreUrl))) await new Promise((r) => setTimeout(r, 200));
  }

  async function choose(c: Connection): Promise<Answer> {
    // A client needs no core here: the bundled one stops.
    if (c.mode !== "local") {
      core?.stop();
      core = undefined;
    }
    saveConnection(dataDir, c);
    conn = c;
    await open(true);
    return { ok: true };
  }

  /** The bundled terminal (`apx`), run on Electron's own Node like the core. */
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

  /** `firstRun`: just chosen on the first-run screen, so the panel's setup opens by saying APX is installed. */
  async function open(firstRun = false): Promise<void> {
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
        if (await load(url, firstRun)) return opts.opened(url, { url: opts.coreUrl, token: localCoreToken() });
      }
      return unreachable(
        opts.coreUrl,
        app.isPackaged ? `See core.log in ${app.getPath("logs")}.` : "Start it with pnpm dev.",
      );
    }
    if (conn.mode === "url") {
      // A remote core gets this computer's browser only once the desktop pairs as a node of its own (not yet).
      if (await load(conn.url, firstRun)) return opts.opened(conn.url, undefined);
      return unreachable(conn.url, "");
    }
    tunnel ??= startTunnel(conn.target, corePort, () => {});
    await waitUp(tunnel.url, 20_000);
    if (await load(tunnel.url, firstRun)) return opts.opened(tunnel.url, { url: tunnel.url, token: undefined });
    return unreachable(`${conn.target} (SSH)`, "");
  }

  async function load(url: string, firstRun = false): Promise<boolean> {
    const page = new URL(url);
    if (firstRun) page.searchParams.set("welcome", "installed");
    try {
      await opts.panel.loadURL(firstRun ? page.toString() : url);
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
    /**
     * Back to the first-run choice in the same window. Nothing restarts: a checkout's supervisor (`pnpm app`) takes its
     * core down with the app.
     */
    async change(): Promise<void> {
      forgetConnection(dataDir);
      conn = undefined;
      tunnel?.stop();
      tunnel = undefined;
      await open();
    },
    stop(): void {
      core?.stop();
      tunnel?.stop();
    },
  };
}
