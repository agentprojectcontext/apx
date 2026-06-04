// Per-user "launch APX Desktop at login" wiring. Used by BOTH the CLI
// (`apx desktop install` / `uninstall`) and the daemon's
// /desktop/autostart endpoint so the web admin can toggle the same setting
// without shelling out.
//
// Per-user, never sudo, fully reversible. Three platforms supported:
//
//   macOS  → ~/Library/LaunchAgents/dev.apx.desktop.plist + launchctl load -w
//   win32  → HKCU\Software\Microsoft\Windows\CurrentVersion\Run\APXDesktop
//   linux  → ~/.config/autostart/apx-desktop.desktop
//
// Functions return plain { ok, message? } / boolean results — never throw,
// never process.exit — so the daemon's HTTP layer can map them to status
// codes and the CLI can render them as ANSI lines.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const AUTOSTART_LABEL      = "dev.apx.desktop";
export const MAC_PLIST_PATH       = path.join(os.homedir(), "Library", "LaunchAgents", `${AUTOSTART_LABEL}.plist`);
export const LINUX_DESKTOP_PATH   = path.join(os.homedir(), ".config", "autostart", "apx-desktop.desktop");
export const WIN_RUN_KEY          = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const WIN_RUN_NAME         = "APXDesktop";
const AUTOSTART_LOG_PATH          = path.join(os.homedir(), ".apx", "desktop-autostart.log");

// ── runner resolution ────────────────────────────────────────────────────

/**
 * Returns the [bin, ...args] tuple a launchd plist / Windows Run / Linux
 * .desktop entry should invoke. We DO NOT use the `apx` shim — pnpm/npm
 * shims are shell scripts that `exec node`, and launchd's PATH is minimal
 * (no nvm, often no /usr/local/bin), so they fail at boot with
 * "exec: node: not found". Using `process.execPath` (absolute path of the
 * node binary currently running this process) + the absolute CLI script is
 * launchctl-safe on every platform.
 */
export function getApxRunner() {
  // From core/desktop/ → up 2 to project root → src/interfaces/cli/index.js.
  const cli = path.resolve(__dirname, "..", "..", "interfaces", "cli", "index.js");
  return [process.execPath, cli];
}

// ── XML helpers ──────────────────────────────────────────────────────────

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

export function buildPlist(runner, logFile) {
  const args = [...runner, "desktop", "start"];
  const argsXml = args.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AUTOSTART_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logFile)}</string>
</dict>
</plist>
`;
}

// ── public API ───────────────────────────────────────────────────────────

/** Boolean: is the autostart entry currently registered on this platform? */
export function autostartIsOn() {
  try {
    if (process.platform === "darwin") return fs.existsSync(MAC_PLIST_PATH);
    if (process.platform === "linux")  return fs.existsSync(LINUX_DESKTOP_PATH);
    if (process.platform === "win32") {
      const out = execFileSync("reg", ["query", WIN_RUN_KEY, "/v", WIN_RUN_NAME], {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
      return new RegExp(WIN_RUN_NAME).test(out);
    }
  } catch {}
  return false;
}

/**
 * Enable autostart. Idempotent — running twice is safe.
 * @returns {{ ok: boolean, message?: string, error?: string, runs?: string, path?: string }}
 */
export function autostartInstall() {
  const runner = getApxRunner();
  const sh = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
  const cmdline = [...runner, "desktop", "start"].map(sh).join(" ");

  if (process.platform === "darwin") {
    try {
      fs.mkdirSync(path.dirname(MAC_PLIST_PATH), { recursive: true });
      fs.mkdirSync(path.dirname(AUTOSTART_LOG_PATH), { recursive: true });
      fs.writeFileSync(MAC_PLIST_PATH, buildPlist(runner, AUTOSTART_LOG_PATH), "utf8");
      try { execFileSync("launchctl", ["unload", MAC_PLIST_PATH], { stdio: "ignore" }); } catch {}
      execFileSync("launchctl", ["load", "-w", MAC_PLIST_PATH], { stdio: "ignore" });
      return { ok: true, runs: cmdline, path: MAC_PLIST_PATH };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  if (process.platform === "win32") {
    try {
      execFileSync("reg", [
        "add", WIN_RUN_KEY, "/v", WIN_RUN_NAME, "/t", "REG_SZ", "/d", cmdline, "/f",
      ], { stdio: "ignore" });
      return { ok: true, runs: cmdline, path: `${WIN_RUN_KEY}\\${WIN_RUN_NAME}` };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  if (process.platform === "linux") {
    try {
      fs.mkdirSync(path.dirname(LINUX_DESKTOP_PATH), { recursive: true });
      fs.writeFileSync(LINUX_DESKTOP_PATH,
        `[Desktop Entry]\nType=Application\nName=APX Desktop\nExec=${cmdline}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`,
        "utf8");
      return { ok: true, runs: cmdline, path: LINUX_DESKTOP_PATH };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  return { ok: false, error: `autostart not supported on platform: ${process.platform}` };
}

/**
 * Disable autostart. Idempotent — no-op if not installed.
 * @returns {{ ok: boolean, removed?: boolean, path?: string, error?: string }}
 */
export function autostartUninstall() {
  if (process.platform === "darwin") {
    if (!fs.existsSync(MAC_PLIST_PATH)) return { ok: true, removed: false };
    try {
      try { execFileSync("launchctl", ["unload", "-w", MAC_PLIST_PATH], { stdio: "ignore" }); } catch {}
      fs.unlinkSync(MAC_PLIST_PATH);
      return { ok: true, removed: true, path: MAC_PLIST_PATH };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  if (process.platform === "win32") {
    try {
      execFileSync("reg", ["delete", WIN_RUN_KEY, "/v", WIN_RUN_NAME, "/f"], { stdio: "ignore" });
      return { ok: true, removed: true, path: `${WIN_RUN_KEY}\\${WIN_RUN_NAME}` };
    } catch {
      return { ok: true, removed: false };
    }
  }
  if (process.platform === "linux") {
    if (!fs.existsSync(LINUX_DESKTOP_PATH)) return { ok: true, removed: false };
    try {
      fs.unlinkSync(LINUX_DESKTOP_PATH);
      return { ok: true, removed: true, path: LINUX_DESKTOP_PATH };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  return { ok: false, error: `autostart not supported on platform: ${process.platform}` };
}
