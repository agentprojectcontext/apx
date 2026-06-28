// apx desktop — launch/manage the floating voice desktop window (Electron).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { http } from "../http.js";
import {
  autostartIsOn as _autostartIsOn,
  autostartInstall,
  autostartUninstall,
  getApxRunner as _getApxRunner,
  buildPlist as _buildPlist,
  MAC_PLIST_PATH,
  LINUX_DESKTOP_PATH,
  WIN_RUN_KEY,
  WIN_RUN_NAME,
} from "#core/desktop/autostart.js";

// Re-exports — kept so existing tests (tests/desktop-autostart.test.js)
// can still import these directly from the CLI module.
export const getApxRunner = _getApxRunner;
export const buildPlist   = _buildPlist;
export const autostartIsOn = _autostartIsOn;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DESKTOP_MAIN  = path.resolve(__dirname, "../../desktop/main.js");
const DESKTOP_PID   = path.join(os.homedir(), ".apx", "desktop.pid");

// ── ANSI ─────────────────────────────────────────────────────────────────────
const c = { reset:"\x1b[0m", bold:"\x1b[1m", dim:"\x1b[2m", green:"\x1b[32m",
            red:"\x1b[31m", yellow:"\x1b[33m", cyan:"\x1b[36m", gray:"\x1b[90m" };
const fmt = {
  bold:(s)=>`${c.bold}${s}${c.reset}`, dim:(s)=>`${c.dim}${s}${c.reset}`,
  green:(s)=>`${c.green}${s}${c.reset}`, red:(s)=>`${c.red}${s}${c.reset}`,
  cyan:(s)=>`${c.cyan}${s}${c.reset}`,  gray:(s)=>`${c.gray}${s}${c.reset}`,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function readPid() {
  try { return parseInt(fs.readFileSync(DESKTOP_PID, "utf8").trim(), 10); } catch { return null; }
}
function writePid(pid) {
  fs.mkdirSync(path.dirname(DESKTOP_PID), { recursive: true });
  fs.writeFileSync(DESKTOP_PID, String(pid));
}
function clearPid() { try { fs.unlinkSync(DESKTOP_PID); } catch {} }
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Validate that an electron candidate actually runs (a pnpm shim can exist as a
// file while its underlying package was never built — `--version` smokes that out).
function electronRuns(cmd, argv) {
  try {
    execFileSync(cmd, argv, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch { return false; }
}

// Returns a descriptor used by buildElectronSpawn():
//   absolute path to a real electron binary,
//   absolute path to electron's cli.js (".js" → run via node),
//   "npx" as a last-resort fallback (downloads/uses electron via npx).
// Never returns null — npx is always attempted so the user gets a real error
// from the spawn (and a one-time download) rather than a silent no-op.
export function findElectron() {
  // commands/ is 4 levels under the project root: src/interfaces/cli/commands/
  const root = path.resolve(__dirname, "..", "..", "..", "..");
  const bin  = path.join(root, "node_modules", ".bin", "electron");
  // The .bin shim is a shell wrapper that `exec node …`. Under launchd's
  // minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) `node` isn't found, so the
  // shim fails. We try it first (cheap, works for terminal use) and then fall
  // back to invoking electron's cli.js directly with process.execPath, which
  // is launchd-safe.
  if (fs.existsSync(bin) && electronRuns(bin, ["--version"])) return bin;

  const cli = path.join(root, "node_modules", "electron", "cli.js");
  if (fs.existsSync(cli) && electronRuns(process.execPath, [cli, "--version"])) return cli;

  // Global electron on PATH (works from terminal, usually not from launchd)
  try {
    const which = execFileSync("which", ["electron"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (which && electronRuns(which, ["--version"])) return which;
  } catch {}

  // Last resort: npx (pulls electron if absent). Will ENOENT under launchd if
  // npx isn't on PATH — that's why we try cli.js BEFORE this.
  return "npx";
}

// Turn a findElectron() descriptor + the app entry into a { cmd, argv } pair.
export function buildElectronSpawn(descriptor, mainPath, port) {
  if (descriptor === "npx") {
    return { cmd: "npx", argv: ["-y", "electron", mainPath, "--port", port] };
  }
  if (descriptor.endsWith(".js")) {
    return { cmd: process.execPath, argv: [descriptor, mainPath, "--port", port] };
  }
  return { cmd: descriptor, argv: [mainPath, "--port", port] };
}

// ── Commands ──────────────────────────────────────────────────────────────────

export async function cmdDesktopStart(args = {}) {
  const debug = !!(args.debug || args.d);

  const pid = readPid();
  if (pidAlive(pid)) {
    if (debug) {
      console.log(`\n  ${fmt.cyan("●")} Desktop already running ${fmt.dim("pid " + pid)} — stop it first with: apx desktop stop\n`);
      return;
    }
    console.log(`\n  ${fmt.cyan("●")} Desktop already running ${fmt.dim("pid " + pid)}\n`);
    return;
  }
  clearPid();

  if (!fs.existsSync(DESKTOP_MAIN)) {
    console.error(`\n  ${fmt.red("✗")} Desktop app not found at ${fmt.dim(DESKTOP_MAIN)}\n`);
    process.exit(1);
  }

  const electronDescriptor = findElectron();

  // Get daemon port from running daemon or env
  let daemonPort = process.env.APX_PORT || "7430";
  try {
    const health = await http.get("/health").catch(() => null);
    if (health?.port) daemonPort = String(health.port);
  } catch {}

  const { cmd, argv } = buildElectronSpawn(electronDescriptor, DESKTOP_MAIN, daemonPort);

  const logFile = path.join(os.homedir(), ".apx", "desktop.log");

  if (debug) {
    // ── Debug mode: start desktop normally, then tail -f the log ─────────
    // Truncate log so we only see fresh output
    try { fs.writeFileSync(logFile, `--- APX Desktop debug started ${new Date().toISOString()} ---\n`); } catch {}

    const logFd = fs.openSync(logFile, "a");
    const child = spawn(cmd, argv, {
      detached: false,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
    });
    fs.closeSync(logFd);

    if (child.pid) writePid(child.pid);

    // Small pause so Electron writes its first lines before we tail
    await new Promise(r => setTimeout(r, 600));

    console.log(
      `\n  ${fmt.cyan("◉")} ${fmt.bold("APX Desktop")} ${fmt.yellow("[DEBUG]")}` +
      `  pid ${child.pid}  port ${daemonPort}` +
      `\n  ${fmt.dim("Tailing:")} ${logFile}` +
      `\n  ${fmt.dim("Press Ctrl+C to stop tailing (desktop keeps running).")}\n`
    );

    // Tail the log file live — read new bytes as they arrive
    const logStream = fs.createReadStream(logFile, { encoding: "utf8", start: 0 });
    logStream.pipe(process.stdout);

    // After initial content, watch for new data
    const watcher = fs.watch(logFile, () => {});
    let pos = fs.statSync(logFile).size;
    const interval = setInterval(() => {
      const stat = fs.statSync(logFile);
      if (stat.size > pos) {
        const stream = fs.createReadStream(logFile, { start: pos, end: stat.size });
        stream.on("data", (chunk) => {
          const lines = chunk.toString();
          // Filter Chromium noise
          lines.split("\n").forEach(line => {
            if (!/^\[[\d:]+\]/.test(line.trim())) process.stdout.write(line + (line ? "\n" : ""));
          });
        });
        pos = stat.size;
      }
    }, 300);

    child.on("exit", (code) => {
      clearInterval(interval);
      watcher.close();
      console.log(`\n  ${code === 0 ? fmt.green("✓") : fmt.red("✗")} Desktop exited (code ${code})\n`);
      clearPid();
      process.exit(code || 0);
    });

    await new Promise((resolve) => {
      process.on("SIGINT", () => {
        clearInterval(interval);
        watcher.close();
        console.log(`\n  ${fmt.dim("Stopped tailing. Desktop is still running.")}\n`);
        resolve();
      });
      process.on("SIGTERM", resolve);
    });
    return;
  }

  // ── Normal (detached) mode ────────────────────────────────────────────
  // detached:true is REQUIRED for the autostart case — launchd kills the
  // entire process group of a LaunchAgent when the "main" process (this
  // wrapper) exits. detached:true gives the Electron child its own session
  // (setsid), so it survives the wrapper's 1.5s exit. unref() below lets
  // the wrapper's event loop end naturally.
  const logFd = fs.openSync(logFile, "a");
  const child = spawn(cmd, argv, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  });

  // Give the process 1.5s to fail fast, then detach and let it run
  await new Promise((res) => {
    let exited = false;
    child.on("exit", (code) => {
      exited = true;
      if (code !== 0) {
        console.error(
          `\n  ${fmt.red("✗")} Desktop exited with code ${code}\n` +
          `  ${fmt.dim("Check log:")} ${logFile}\n` +
          `  ${fmt.dim("Or run with:")} ${fmt.cyan("apx desktop start --debug")}\n`
        );
      }
      res();
    });
    setTimeout(() => {
      if (!exited) {
        child.unref();
        res();
      }
    }, 1500);
  });

  if (!child.exitCode && child.pid) writePid(child.pid);
  else return;

  // Read configured shortcut (if any) for display
  let shortcutHint = "⌘G (macOS) / Ctrl+G (Win/Linux)";
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".apx", "config.json"), "utf8"));
    const sc = cfg?.desktop?.shortcut || cfg?.overlay?.shortcut;
    if (sc) shortcutHint = sc;
  } catch {}

  console.log(
    `\n  ${fmt.green("●")} ${fmt.bold("APX Desktop")} started` +
    `  ${fmt.dim("pid " + child.pid)}` +
    `  ${fmt.dim("port " + daemonPort)}` +
    `\n  ${fmt.dim("Shortcut:")} ${fmt.cyan(shortcutHint)}` +
    `\n  ${fmt.dim("Debug:")}    ${fmt.gray("apx desktop start --debug")}` +
    `\n  ${fmt.dim("Log:")}      ${fmt.gray(logFile)}\n`
  );
}

export async function cmdDesktopStop(_args = {}) {
  const pid = readPid();
  if (!pidAlive(pid)) {
    console.log(`\n  ${fmt.dim("Desktop is not running.")}\n`);
    clearPid();
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    clearPid();
    console.log(`\n  ${fmt.green("✓")} Desktop stopped ${fmt.dim("(pid " + pid + ")")}\n`);
  } catch (e) {
    console.error(`\n  ${fmt.red("✗")} Could not stop desktop: ${e.message}\n`);
  }
}

// True when the desktop Electron process is alive. Used by `apx restart` so it
// only re-launches the desktop if the user already had it running.
export function desktopRunning() {
  return pidAlive(readPid());
}

// Stop (if running) then start — the only way the desktop picks up new
// renderer/main.js code after a pull, since the Electron process holds the
// old bundle in memory. Token re-sync after a daemon restart is handled
// automatically by the WS reconnect (it re-reads daemon.token), so this is
// purely about refreshing stale desktop CODE.
export async function cmdDesktopRestart(args = {}) {
  const pid = readPid();
  if (pidAlive(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch {}
    clearPid();
    // Give Electron a moment to release the tray/shortcut before relaunch.
    await new Promise((r) => setTimeout(r, 600));
    process.stderr.write("apx: restarting desktop...\n");
  } else {
    clearPid();
    process.stderr.write("apx: desktop not running — starting...\n");
  }
  await cmdDesktopStart(args);
}

export async function cmdDesktopStatus(_args = {}) {
  const pid = readPid();
  const alive = pidAlive(pid);

  let daemonClients = 0;
  try {
    const s = await http.get("/desktop/status").catch(() => null);
    daemonClients = s?.connected_clients ?? 0;
  } catch {}

  const icon  = alive ? fmt.green("●") : fmt.dim("○");
  const state = alive ? fmt.green("running") : fmt.dim("stopped");
  const autoIcon  = autostartIsOn() ? fmt.green("●") : fmt.dim("○");
  const autoState = autostartIsOn() ? fmt.green("on") : fmt.dim("off");
  console.log(
    `\n  ${icon} ${fmt.bold("APX Desktop")}  ${state}` +
    (pid ? `  ${fmt.dim("pid " + pid)}` : "") +
    `\n  ${fmt.dim("daemon connections:")} ${daemonClients}` +
    `\n  ${autoIcon} ${fmt.dim("autostart:")} ${autoState}\n`
  );
}

// ── Autostart (opt-in: apx desktop install / uninstall) ───────────────────
//
// All the heavy lifting lives in core/desktop/autostart.js so the daemon's
// /desktop/autostart endpoint and these CLI commands share a single
// implementation. The functions below are just ANSI/UX wrappers around it.

export async function cmdDesktopInstall(_args = {}) {
  const r = autostartInstall();
  if (!r.ok) {
    console.error(`\n  ${fmt.red("✗")} ${r.error}\n`);
    process.exit(1);
  }
  console.log(
    `\n  ${fmt.green("✓")} ${fmt.bold("Autostart activado")}` +
    (r.runs ? `\n  ${fmt.dim("runs:")}  ${r.runs}`  : "") +
    (r.path ? `\n  ${fmt.dim("entry:")} ${r.path}` : "") +
    `\n  ${fmt.dim("La ventana arrancará automáticamente en el próximo login.")}` +
    `\n  ${fmt.dim("Para desactivar:")} ${fmt.cyan("apx desktop uninstall")}\n`
  );
}

export async function cmdDesktopUninstall(_args = {}) {
  const r = autostartUninstall();
  if (!r.ok) {
    console.error(`\n  ${fmt.red("✗")} ${r.error}\n`);
    process.exit(1);
  }
  if (!r.removed) {
    console.log(`\n  ${fmt.dim("Autostart no estaba activado.")}\n`);
    return;
  }
  console.log(`\n  ${fmt.green("✓")} Autostart desactivado.\n  ${fmt.dim("Se eliminó:")} ${r.path}\n`);
}

