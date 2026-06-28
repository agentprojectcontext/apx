// Desktop (Electron floating window) process control — shared by the CLI
// (`apx desktop start/stop/restart`) and the daemon's /desktop/{start,stop}
// HTTP endpoints, so both spawn/kill the window the exact same way.
//
// The window is a detached Electron process (it must survive the spawner so a
// LaunchAgent / a short-lived CLI invocation doesn't take it down). State is
// tracked via ~/.apx/desktop.pid.

"use strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/core/desktop/ → repo root is three levels up.
const ROOT = path.resolve(__dirname, "..", "..", "..");
export const DESKTOP_MAIN = path.resolve(__dirname, "..", "..", "interfaces", "desktop", "main.js");
export const DESKTOP_PID = path.join(os.homedir(), ".apx", "desktop.pid");
const DESKTOP_LOG = path.join(os.homedir(), ".apx", "desktop.log");

// ── PID file ────────────────────────────────────────────────────────────────
export function readPid() {
  try { return parseInt(fs.readFileSync(DESKTOP_PID, "utf8").trim(), 10); } catch { return null; }
}
export function writePid(pid) {
  fs.mkdirSync(path.dirname(DESKTOP_PID), { recursive: true });
  fs.writeFileSync(DESKTOP_PID, String(pid));
}
export function clearPid() { try { fs.unlinkSync(DESKTOP_PID); } catch {} }
export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
export function isDesktopRunning() { return pidAlive(readPid()); }

// ── Electron resolution ───────────────────────────────────────────────────
// Validate a candidate actually runs (a pnpm shim can exist as a file while its
// underlying package was never built — `--version` smokes that out).
function electronRuns(cmd, argv) {
  try { execFileSync(cmd, argv, { stdio: "ignore", timeout: 5000 }); return true; } catch { return false; }
}

// Returns a descriptor for buildElectronSpawn(): an absolute electron binary
// path, electron's cli.js (".js" → run via node), a global bin, or "npx" as a
// last resort. Never returns null.
export function findElectron() {
  const bin = path.join(ROOT, "node_modules", ".bin", "electron");
  if (fs.existsSync(bin) && electronRuns(bin, ["--version"])) return bin;

  const cli = path.join(ROOT, "node_modules", "electron", "cli.js");
  if (fs.existsSync(cli) && electronRuns(process.execPath, [cli, "--version"])) return cli;

  try {
    const which = execFileSync("which", ["electron"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (which && electronRuns(which, ["--version"])) return which;
  } catch {}

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

// ── Lifecycle ───────────────────────────────────────────────────────────────
// Spawn the window detached (survives the spawner). No console output — callers
// format their own UX. Returns { ok, pid, already? } | { ok:false, error }.
// detached:true gives the child its own session so a LaunchAgent / short-lived
// CLI doesn't drag it down on exit; we unref() after a 1.5s fail-fast window.
export async function startDesktopDetached({ port = process.env.APX_PORT || "7430" } = {}) {
  if (isDesktopRunning()) return { ok: true, pid: readPid(), already: true };
  clearPid();
  if (!fs.existsSync(DESKTOP_MAIN)) return { ok: false, error: `desktop app not found at ${DESKTOP_MAIN}` };

  const { cmd, argv } = buildElectronSpawn(findElectron(), DESKTOP_MAIN, String(port));
  let logFd;
  try { logFd = fs.openSync(DESKTOP_LOG, "a"); } catch { logFd = "ignore"; }

  let child;
  try {
    child = spawn(cmd, argv, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
    });
  } catch (e) {
    if (typeof logFd === "number") { try { fs.closeSync(logFd); } catch {} }
    return { ok: false, error: e.message };
  }
  if (typeof logFd === "number") { try { fs.closeSync(logFd); } catch {} }

  const res = await new Promise((resolve) => {
    let settled = false;
    child.on("exit", (code) => { if (!settled) { settled = true; resolve({ ok: code === 0, code }); } });
    setTimeout(() => { if (!settled) { settled = true; child.unref(); resolve({ ok: true }); } }, 1500);
  });
  if (!res.ok) return { ok: false, error: `desktop exited with code ${res.code}` };

  if (child.pid) writePid(child.pid);
  return { ok: true, pid: child.pid };
}

// Stop the running window (SIGTERM). Returns { ok, stopped, pid? } — stopped is
// false when nothing was running.
export function stopDesktop() {
  const pid = readPid();
  if (!pidAlive(pid)) { clearPid(); return { ok: true, stopped: false }; }
  try {
    process.kill(pid, "SIGTERM");
    clearPid();
    return { ok: true, stopped: true, pid };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
