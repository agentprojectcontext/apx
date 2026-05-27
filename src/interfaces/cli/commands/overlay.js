// apx overlay — launch/manage the floating voice overlay window.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { http } from "../http.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const OVERLAY_MAIN  = path.resolve(__dirname, "../../overlay/main.js");
const OVERLAY_PID   = path.join(os.homedir(), ".apx", "overlay.pid");

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
  try { return parseInt(fs.readFileSync(OVERLAY_PID, "utf8").trim(), 10); } catch { return null; }
}
function writePid(pid) {
  fs.mkdirSync(path.dirname(OVERLAY_PID), { recursive: true });
  fs.writeFileSync(OVERLAY_PID, String(pid));
}
function clearPid() { try { fs.unlinkSync(OVERLAY_PID); } catch {} }
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function findElectron() {
  // 1. Local node_modules (pnpm/npm install electron)
  const candidates = [
    path.resolve(__dirname, "../../../node_modules/.bin/electron"),
    path.resolve(__dirname, "../../../node_modules/electron/cli.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // 2. Global electron
  try {
    const which = execFileSync("which", ["electron"], { stdio: ["ignore","pipe","ignore"] }).toString().trim();
    if (which) return which;
  } catch {}
  // 3. npx electron
  return null;
}

// ── Commands ──────────────────────────────────────────────────────────────────

export async function cmdOverlayStart(args = {}) {
  const debug = !!(args.debug || args.d);

  const pid = readPid();
  if (pidAlive(pid)) {
    if (debug) {
      console.log(`\n  ${fmt.cyan("●")} Overlay already running ${fmt.dim("pid " + pid)} — stop it first with: apx overlay stop\n`);
      return;
    }
    console.log(`\n  ${fmt.cyan("●")} Overlay already running ${fmt.dim("pid " + pid)}\n`);
    return;
  }
  clearPid();

  if (!fs.existsSync(OVERLAY_MAIN)) {
    console.error(`\n  ${fmt.red("✗")} Overlay app not found at ${fmt.dim(OVERLAY_MAIN)}\n`);
    process.exit(1);
  }

  const electronBin = findElectron();
  if (!electronBin) {
    console.error(
      `\n  ${fmt.red("✗")} Electron not found.\n` +
      `  Install it with:  ${fmt.cyan("pnpm add -D electron")}\n` +
      `  or globally:      ${fmt.cyan("npm install -g electron")}\n`
    );
    process.exit(1);
  }

  // Get daemon port from running daemon or env
  let daemonPort = process.env.APX_PORT || "7430";
  try {
    const health = await http.get("/health").catch(() => null);
    if (health?.port) daemonPort = String(health.port);
  } catch {}

  const isScript = electronBin.endsWith(".js");
  const cmd  = isScript ? process.execPath : electronBin;
  const argv = isScript
    ? [electronBin, OVERLAY_MAIN, "--port", daemonPort]
    : [OVERLAY_MAIN, "--port", daemonPort];

  const logFile = path.join(os.homedir(), ".apx", "overlay.log");

  if (debug) {
    // ── Debug mode: start overlay normally, then tail -f the log ─────────
    // Truncate log so we only see fresh output
    try { fs.writeFileSync(logFile, `--- APX Overlay debug started ${new Date().toISOString()} ---\n`); } catch {}

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
      `\n  ${fmt.cyan("◉")} ${fmt.bold("APX Overlay")} ${fmt.yellow("[DEBUG]")}` +
      `  pid ${child.pid}  port ${daemonPort}` +
      `\n  ${fmt.dim("Tailing:")} ${logFile}` +
      `\n  ${fmt.dim("Press Ctrl+C to stop tailing (overlay keeps running).")}\n`
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
      console.log(`\n  ${code === 0 ? fmt.green("✓") : fmt.red("✗")} Overlay exited (code ${code})\n`);
      clearPid();
      process.exit(code || 0);
    });

    await new Promise((resolve) => {
      process.on("SIGINT", () => {
        clearInterval(interval);
        watcher.close();
        console.log(`\n  ${fmt.dim("Stopped tailing. Overlay is still running.")}\n`);
        resolve();
      });
      process.on("SIGTERM", resolve);
    });
    return;
  }

  // ── Normal (detached) mode ────────────────────────────────────────────
  const logFd = fs.openSync(logFile, "a");
  const child = spawn(cmd, argv, {
    detached: false,
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
          `\n  ${fmt.red("✗")} Overlay exited with code ${code}\n` +
          `  ${fmt.dim("Check log:")} ${logFile}\n` +
          `  ${fmt.dim("Or run with:")} ${fmt.cyan("apx overlay start --debug")}\n`
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
    if (cfg?.overlay?.shortcut) shortcutHint = cfg.overlay.shortcut;
  } catch {}

  console.log(
    `\n  ${fmt.green("●")} ${fmt.bold("APX Overlay")} started` +
    `  ${fmt.dim("pid " + child.pid)}` +
    `  ${fmt.dim("port " + daemonPort)}` +
    `\n  ${fmt.dim("Shortcut:")} ${fmt.cyan(shortcutHint)}` +
    `\n  ${fmt.dim("Debug:")}    ${fmt.gray("apx overlay start --debug")}` +
    `\n  ${fmt.dim("Log:")}      ${fmt.gray(logFile)}\n`
  );
}

export async function cmdOverlayStop(_args = {}) {
  const pid = readPid();
  if (!pidAlive(pid)) {
    console.log(`\n  ${fmt.dim("Overlay is not running.")}\n`);
    clearPid();
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    clearPid();
    console.log(`\n  ${fmt.green("✓")} Overlay stopped ${fmt.dim("(pid " + pid + ")")}\n`);
  } catch (e) {
    console.error(`\n  ${fmt.red("✗")} Could not stop overlay: ${e.message}\n`);
  }
}

export async function cmdOverlayStatus(_args = {}) {
  const pid = readPid();
  const alive = pidAlive(pid);

  let daemonClients = 0;
  try {
    const s = await http.get("/overlay/status").catch(() => null);
    daemonClients = s?.connected_clients ?? 0;
  } catch {}

  const icon  = alive ? fmt.green("●") : fmt.dim("○");
  const state = alive ? fmt.green("running") : fmt.dim("stopped");
  console.log(
    `\n  ${icon} ${fmt.bold("APX Overlay")}  ${state}` +
    (pid ? `  ${fmt.dim("pid " + pid)}` : "") +
    `\n  ${fmt.dim("daemon connections:")} ${daemonClients}\n`
  );
}
