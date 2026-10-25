// What the window opens: the first-run choice (server or client) on an installed app, then the APX it chose — its
// own core here, one at an address, or one over SSH. The panel is the same web app in every case.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, ipcMain, type WebContents } from "electron";
import { APP_SCHEME, FIRST_RUN_URL } from "./app-scheme.ts";
import { openAskpass, type Prompt } from "./askpass.ts";
import {
  type Connection,
  forgetConnection,
  initialConnection,
  loadConnection,
  localCoreHome,
  localCoreLogFile,
  localCoreToken,
  normalizeUrl,
  saveConnection,
  validSshTarget,
  verifyLocalCore,
} from "./connection.ts";
import { type EmbeddedCore, isUp, startEmbeddedCore, waitUp } from "./core-process.ts";
import { type Remote, reachRemote, waitingHtml } from "./remote-wait.ts";
import { appKeyPath, askpassSupported, authorizeKey, ensureAppKey, localSshVersion } from "./ssh-login.ts";
import {
  installArgs,
  remoteApx,
  remoteInstall,
  remoteLinger,
  startTunnel,
  type Tunnel,
  useIdentity,
} from "./ssh-tunnel.ts";

// ready: installed on a server and reachable, but not opened yet (the screen says so first); linger names the user
// whose services stop at logout until they linger. key: this app's public key, for the owner to add by hand.
type Answer =
  | { ok: true; ready?: true; linger?: string }
  | { ok: false; reason?: string; error?: string; key?: string };
type Step = "ssh" | "login" | "probe" | "install" | "connect";

export function createConnector(opts: {
  panel: WebContents;
  coreUrl: string;
  webUrl: string;
  dist: string;
  /** Whether a window asking for the core token is one of APX's own (the panel or the quick chat). */
  isOwnWindow: (sender: WebContents) => boolean;
  /** Revoke capabilities before a connection changes or the app quits. */
  disconnected: () => void;
  /** The panel loaded from this address; `node` is the core the desktop lends its browser to, when it can reach it. */
  opened: (url: string, node: { url: string; token: string | undefined } | undefined) => void;
}) {
  const dataDir = app.getPath("userData");
  const corePort = Number(new URL(opts.coreUrl).port || 7440);
  // Asked once (installed or from a checkout) and kept; APX_CONNECTION=local skips the question (tests, scripts).
  let conn: Connection | undefined = initialConnection(dataDir);
  let core: EmbeddedCore | undefined;
  let tunnel: Tunnel | undefined;
  // The remote panel (an address or SSH) is on screen: losing its server from here on waits for it again.
  let openedRemote = false;
  let connectionRevision = 0;
  // ssh's questions waiting for the owner's answer on the first-run screen (never logged, never kept).
  const pending = new Map<string, (answer: string | undefined) => void>();
  useIdentity(appKeyPath(dataDir));

  // The panel reloads itself (a new build after an update, a lazy chunk that failed): with its server away, Chromium
  // leaves an empty page, so the window waits for the server again instead.
  opts.panel.on("did-fail-load", (_e, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !openedRemote) return;
    if (url.startsWith("data:") || url.startsWith(`${APP_SCHEME}:`)) return;
    reconnect();
  });

  const onChooser = (sender: WebContents) =>
    sender === opts.panel && sender.getURL().startsWith(`${APP_SCHEME}://app/`);

  ipcMain.on("desktop:core-token", (e) => {
    e.returnValue = conn?.mode === "local" && opts.isOwnWindow(e.sender) ? localCoreToken() : undefined;
  });

  ipcMain.on("desktop:core-local", (e) => {
    e.returnValue = conn?.mode === "local" && opts.isOwnWindow(e.sender);
  });

  ipcMain.handle("connect:local", async (e, access: unknown): Promise<Answer> => {
    const revision = connectionRevision;
    if (!onChooser(e.sender)) return { ok: false, error: "not allowed" };
    if (access !== "none" && access !== "lan" && access !== "tailscale") return { ok: false, error: "bad access" };
    // "Only this computer" undoes an earlier LAN or Tailscale choice too.
    const r = runCli(["expose", access === "none" ? "off" : access]);
    if (!r.ok) return r;
    await restartOwnCore();
    return choose({ mode: "local" }, revision);
  });

  ipcMain.handle("connect:url", async (e, input: unknown): Promise<Answer> => {
    const revision = connectionRevision;
    if (!onChooser(e.sender)) return { ok: false, error: "not allowed" };
    const url = typeof input === "string" ? normalizeUrl(input) : undefined;
    if (!url) return { ok: false, reason: "badUrl" };
    if (!(await isUp(url))) return { ok: false, reason: "notReachable" };
    return choose({ mode: "url", url }, revision);
  });

  ipcMain.handle("connect:ssh", async (e, input: unknown): Promise<Answer> => {
    const revision = connectionRevision;
    if (!onChooser(e.sender)) return { ok: false, error: "not allowed" };
    if (typeof input !== "string" || !validSshTarget(input)) return { ok: false, reason: "badSsh" };
    const target = input.trim();
    step(e.sender, "ssh");
    let remote = await remoteApx(target);
    if (remote === "password") {
      const login = await passwordLogin(e.sender, target);
      if (!login.ok) return login;
      remote = await remoteApx(target);
      // The key is in authorized_keys, yet the server still wants a password: it does not take keys.
      if (remote === "password" || remote === "unreachable") return { ok: false, reason: "sshKeyRefused" };
    }
    if (remote === "unreachable") return { ok: false, reason: "sshFailed" };
    step(e.sender, "probe");
    // A core that answers wins, even one put there some other way than an `apx` command.
    try {
      if (!(await sshCoreUp(target))) return { ok: false, reason: remote === "missing" ? "sshNoApx" : "sshDown" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return choose({ mode: "ssh", target }, revision);
  });

  // The owner's answer to the question on screen; `undefined` cancels it.
  ipcMain.on("connect:answer", (e, id: unknown, answer: unknown) => {
    if (!onChooser(e.sender) || typeof id !== "string") return;
    const done = pending.get(id);
    if (!done) return;
    pending.delete(id);
    done(typeof answer === "string" ? answer.replace(/[\r\n]/g, "").slice(0, 4096) : undefined);
  });

  // The server has no APX: this app installs its own version there (install.sh over ssh), then connects.
  ipcMain.handle("connect:ssh-install", async (e, input: unknown): Promise<Answer> => {
    if (!onChooser(e.sender)) return { ok: false, error: "not allowed" };
    if (typeof input !== "string" || !validSshTarget(input)) return { ok: false, reason: "badSsh" };
    const target = input.trim();
    const script = fs.readFileSync(installScript(), "utf8");
    const args = installArgs(app.getVersion(), process.env.APX_RELEASES);
    step(e.sender, "install");
    const r = await remoteInstall(target, script, args, (line) => progress(e.sender, line));
    if (!r.ok) return r;
    step(e.sender, "connect");
    try {
      if (!(await sshCoreUp(target, 30_000))) return { ok: false, reason: "sshDown" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
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
  function step(sender: WebContents, id: Step): void {
    if (!sender.isDestroyed()) sender.send("connect:step", id);
  }

  /** One line of the server's (or ssh's) output for the first-run screen's terminal. */
  function progress(sender: WebContents, line: string): void {
    if (!sender.isDestroyed()) sender.send("connect:progress", line);
  }

  /**
   * The server only takes a password: one interactive ssh asks the owner on the screen (askpass) and adds this app's
   * key there; from then on every ssh logs in with it. An ssh too old to ask without a terminal: the key, by hand.
   */
  async function passwordLogin(sender: WebContents, target: string): Promise<Answer> {
    const pubkey = ensureAppKey(dataDir);
    if (!pubkey || !askpassSupported(localSshVersion()))
      return { ok: false, reason: "sshPasswordManual", ...(pubkey ? { key: pubkey } : {}) };
    step(sender, "login");
    const askpass = await openAskpass({
      ask: (p) => ask(sender, p),
      exe: process.execPath,
      // From a checkout the executable is Electron itself, which needs the app's folder.
      appDir: app.isPackaged ? undefined : app.getAppPath(),
    });
    try {
      const ok = await authorizeKey(target, pubkey, askpass.env, (line) => progress(sender, line));
      return ok ? { ok: true } : { ok: false, reason: "sshAuthFailed" };
    } finally {
      askpass.close();
      for (const done of pending.values()) done(undefined);
      pending.clear();
      if (!sender.isDestroyed()) sender.send("connect:prompt", null);
    }
  }

  function ask(sender: WebContents, prompt: Prompt): Promise<string | undefined> {
    if (sender.isDestroyed()) return Promise.resolve(undefined);
    const id = randomUUID();
    return new Promise((resolve) => {
      pending.set(id, resolve);
      sender.send("connect:prompt", { id, ...prompt });
    });
  }

  async function sshCoreUp(target: string, wait = 15_000): Promise<boolean> {
    const probe = startTunnel(target, corePort, () => {});
    try {
      await probe.ready;
      return (await waitUp(probe.url, wait)) && probe.alive();
    } finally {
      probe.stop();
    }
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
    await core.stop();
    core = undefined;
    const until = Date.now() + 10_000;
    while (Date.now() < until && (await isUp(opts.coreUrl))) await new Promise((r) => setTimeout(r, 200));
  }

  async function choose(c: Connection, expectedRevision: number): Promise<Answer> {
    if (connectionRevision !== expectedRevision) return { ok: false, error: "The connection changed" };
    const revision = ++connectionRevision;
    opts.disconnected();
    // A client needs no core here: the bundled one stops.
    if (c.mode !== "local") {
      await core?.stop();
      core = undefined;
    }
    if (connectionRevision !== revision) return { ok: false, error: "The connection changed" };
    const previous = loadConnection(dataDir);
    if (c.mode === "local" && previous?.mode === "local" && previous.home) c = previous;
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
      env: { ...process.env, APX_URL: "", APX_HOME: localCoreHome(), ELECTRON_RUN_AS_NODE: "1" },
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
    const connection = conn;
    const revision = connectionRevision;
    const current = () => connectionRevision === revision;
    if (!connection) {
      await opts.panel.loadURL(FIRST_RUN_URL);
      return;
    }
    if (connection.mode === "local") {
      // Installed, APX starts its own core unless one already answers; a checkout tries the panel's dev server first.
      if (app.isPackaged && !core) {
        const up = await isUp(opts.coreUrl);
        if (!current()) return;
        if (!up) {
          core = startEmbeddedCore({
            resources: process.resourcesPath,
            home: localCoreHome(),
            port: corePort,
            logFile: localCoreLogFile(),
            cacheDir: path.join(dataDir, "compile-cache"),
          });
          await waitUp(opts.coreUrl);
          if (!current()) return;
        }
      }
      const verified = await verifyLocalCore(opts.coreUrl).catch(() => false);
      if (!current()) return;
      if (!verified)
        return unreachable(
          opts.coreUrl,
          "The local daemon is unavailable or belongs to another home. Check APX_HOME and APX_PORT.",
        );
      for (const url of app.isPackaged ? [opts.coreUrl] : [opts.webUrl, opts.coreUrl]) {
        const loaded = await load(url, firstRun);
        if (!current()) return;
        if (loaded) return opts.opened(url, { url: opts.coreUrl, token: localCoreToken() });
      }
      return unreachable(opts.coreUrl, app.isPackaged ? `See ${localCoreLogFile()}.` : "Start it with pnpm dev.");
    }
    if (connection.mode === "url") {
      // A remote core gets this computer's browser only once the desktop pairs as a node of its own (not yet).
      if (!(await wait({ where: connection.url, url: connection.url }, firstRun, current))) return;
      openedRemote = true;
      return opts.opened(connection.url, undefined);
    }
    const target = connection.target;
    if (!tunnel) {
      const started = startTunnel(
        target,
        corePort,
        () => {},
        (ready) => {
          if (!ready && tunnel === started && openedRemote) reconnect();
        },
        undefined,
        true,
      );
      tunnel = started;
    }
    const activeTunnel = tunnel;
    if (!(await wait({ where: `${target} (SSH)`, url: activeTunnel.url, tunnel: activeTunnel }, firstRun, current)))
      return;
    openedRemote = true;
    return opts.opened(activeTunnel.url, { url: activeTunnel.url, token: undefined });
  }

  /** Waits for a remote APX, saying so on screen, and loads its panel once it answers. */
  function wait(remote: Remote, firstRun: boolean, current: () => boolean): Promise<boolean> {
    const es = app.getLocale().startsWith("es");
    return reachRemote(remote, {
      current,
      isUp,
      load: (url) => load(url, firstRun),
      // A newer page (the panel, the chooser) may replace this one before it finishes loading.
      show: (w) =>
        opts.panel
          .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(waitingHtml(w, es))}#apx-connecting`)
          .catch(() => {}),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: Date.now,
      es,
    });
  }

  /** The remote panel lost its server: the capabilities it was lent go, and the window waits for it again. */
  function reconnect(): void {
    if (conn?.mode !== "url" && conn?.mode !== "ssh") return;
    connectionRevision++;
    openedRemote = false;
    opts.disconnected();
    void open();
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

  function unreachable(where: string, hint: string): Promise<void> {
    return page(
      `APX not reachable at ${where}. ${hint} To pick another APX: APX menu › Change connection.`,
      "apx-unreachable",
    );
  }

  async function page(text: string, id: string): Promise<void> {
    const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const body = `<body style="font:14px system-ui;padding:48px 24px 24px;margin:0;color:#555;background:#fff">${escaped}</body>`;
    // A newer page (the panel, the chooser) may replace this one before it finishes loading.
    await opts.panel.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(body)}#${id}`).catch(() => {});
  }

  return {
    open,
    /**
     * Back to the first-run choice in the same window. Nothing restarts: a checkout's supervisor (`pnpm app`) takes its
     * core down with the app.
     */
    async change(): Promise<void> {
      connectionRevision++;
      opts.disconnected();
      openedRemote = false;
      forgetConnection(dataDir);
      conn = undefined;
      tunnel?.stop();
      tunnel = undefined;
      await open();
    },
    stop(): void {
      connectionRevision++;
      opts.disconnected();
      openedRemote = false;
      void core?.stop();
      tunnel?.stop();
    },
    /** This app runs the core itself: quitting stops the crew's routines and channels too. */
    runsCore(): boolean {
      return core !== undefined;
    },
  };
}
