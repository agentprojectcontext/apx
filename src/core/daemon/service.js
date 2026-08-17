// Run the daemon as a real, self-healing service.
//
// Today the daemon starts transitively — some CLI command calls ensureDaemon()
// and one appears. If it dies at 3am nothing brings it back, so the routines
// that were meant to run at 8:30 do not, and nobody finds out until they
// wonder why the morning message never arrived. A scheduler you cannot rely on
// to be running is not a scheduler.
//
// Per-user, never sudo, fully reversible. Same shape as core/desktop/autostart.js,
// which this deliberately mirrors rather than reinvents:
//
//   macOS  → ~/Library/LaunchAgents/dev.apx.daemon.plist   (KeepAlive true)
//   linux  → ~/.config/systemd/user/apx-daemon.service     (Restart=always)
//   win32  → HKCU\…\Run\APXDaemon                          (see the caveat below)
//
// OPT-IN, always. Installing a system service without being asked is the kind
// of thing that makes people uninstall software, and APX works perfectly well
// without it.
//
// Functions return { ok, … } and never throw or exit, so the CLI and the HTTP
// layer can both render the result.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LOG_DIR } from "#core/config/paths.js";
import { augmentedPath } from "#core/util/path-env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SERVICE_LABEL = "dev.apx.daemon";
export const MAC_PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
export const LINUX_UNIT_PATH = path.join(os.homedir(), ".config", "systemd", "user", "apx-daemon.service");
export const WIN_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const WIN_RUN_NAME = "APXDaemon";

export const SERVICE_LOG_PATH = path.join(LOG_DIR, "daemon-service.log");

/**
 * [bin, ...args] the supervisor should run.
 *
 * TWO things this must NOT be, both of which look right and are not:
 *
 * 1. The `apx` shim. npm/pnpm shims are shell scripts that `exec node`, and a
 *    launchd/systemd environment has a minimal PATH with no nvm and often no
 *    /usr/local/bin, so they fail at boot with "node: not found". That exact
 *    mistake already cost a day of silent voice failures.
 *
 * 2. `apx daemon start`. That command SPAWNS THE DAEMON DETACHED AND EXITS
 *    (cli/http.js autoStart). Under KeepAlive the supervisor would see its
 *    child exit within a second, restart it, and loop forever — spawning a new
 *    daemon each time and never noticing the one already running. A supervised
 *    process must be the daemon itself, in the foreground.
 */
export function getDaemonRunner() {
  const entry = path.resolve(__dirname, "..", "..", "host", "daemon", "index.js");
  return [process.execPath, entry];
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

/**
 * launchd plist with KeepAlive TRUE — the whole point. The desktop's plist sets
 * it false because a window the user closed should stay closed; a daemon that
 * exits should come back.
 */
export function buildDaemonPlist(runner = getDaemonRunner(), logFile = SERVICE_LOG_PATH) {
  const args = [...runner];
  const argsXml = args.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${escapeXml(augmentedPath())}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logFile)}</string>
</dict>
</plist>
`;
}

/** systemd --user unit. `default.target`, not `multi-user.target`: this is a
 *  per-user service that should start with the user's session, not at boot. */
export function buildSystemdUnit(runner = getDaemonRunner()) {
  const exec = [...runner]
    .map((a) => (/\s/.test(a) ? `"${a}"` : a))
    .join(" ");
  return `[Unit]
Description=APX daemon
After=network-online.target

[Service]
Type=simple
ExecStart=${exec}
Environment=PATH=${augmentedPath()}
Restart=always
RestartSec=10
# Give up only if it is crash-looping, so a genuinely broken install does not
# spin forever writing to the log.
StartLimitBurst=5
StartLimitIntervalSec=120

[Install]
WantedBy=default.target
`;
}

/** @returns {{installed: boolean, path?: string, platform: string, supervised: boolean, note?: string}} */
export function serviceStatus(platform = process.platform) {
  if (platform === "darwin") {
    return {
      platform, supervised: true, installed: fs.existsSync(MAC_PLIST_PATH),
      path: MAC_PLIST_PATH,
    };
  }
  if (platform === "linux") {
    return {
      platform, supervised: true, installed: fs.existsSync(LINUX_UNIT_PATH),
      path: LINUX_UNIT_PATH,
    };
  }
  if (platform === "win32") {
    let installed = false;
    try {
      const out = execFileSync("reg", ["query", WIN_RUN_KEY, "/v", WIN_RUN_NAME], {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
      installed = new RegExp(WIN_RUN_NAME).test(out);
    } catch { /* not present */ }
    return {
      platform, installed, supervised: false,
      path: `${WIN_RUN_KEY}\\${WIN_RUN_NAME}`,
      // Said plainly rather than implied. A Run key starts the daemon at login
      // and does NOT restart it if it dies — which is most of what a service is
      // for. Promising self-healing here would be a lie the user only discovers
      // the morning nothing ran.
      note: "starts at login, but does NOT restart the daemon if it dies — " +
            "Windows needs a real service wrapper (nssm/sc.exe) for that, which APX does not ship yet",
    };
  }
  return { platform, installed: false, supervised: false, note: `not supported on ${platform}` };
}

export function installService(platform = process.platform) {
  const runner = getDaemonRunner();

  if (platform === "darwin") {
    try {
      fs.mkdirSync(path.dirname(MAC_PLIST_PATH), { recursive: true });
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(MAC_PLIST_PATH, buildDaemonPlist(runner), "utf8");
      try { execFileSync("launchctl", ["unload", MAC_PLIST_PATH], { stdio: "ignore" }); } catch { /* not loaded */ }
      execFileSync("launchctl", ["load", "-w", MAC_PLIST_PATH], { stdio: "ignore" });
      return { ok: true, path: MAC_PLIST_PATH, supervised: true, log: SERVICE_LOG_PATH };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  if (platform === "linux") {
    try {
      fs.mkdirSync(path.dirname(LINUX_UNIT_PATH), { recursive: true });
      fs.writeFileSync(LINUX_UNIT_PATH, buildSystemdUnit(runner), "utf8");
      execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
      execFileSync("systemctl", ["--user", "enable", "--now", "apx-daemon.service"], { stdio: "ignore" });
      return {
        ok: true, path: LINUX_UNIT_PATH, supervised: true,
        // Without lingering, systemd --user stops when the last session ends,
        // so a headless box would silently lose the daemon on logout.
        note: "for a machine you are not logged into, run: loginctl enable-linger $USER",
      };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  if (platform === "win32") {
    const cmdline = [...runner]
      .map((s) => `"${String(s).replace(/"/g, '\\"')}"`).join(" ");
    try {
      execFileSync("reg", ["add", WIN_RUN_KEY, "/v", WIN_RUN_NAME, "/t", "REG_SZ", "/d", cmdline, "/f"],
        { stdio: "ignore" });
      return {
        ok: true, path: `${WIN_RUN_KEY}\\${WIN_RUN_NAME}`, supervised: false,
        note: serviceStatus("win32").note,
      };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  return { ok: false, error: `service installation not supported on platform: ${platform}` };
}

/** Idempotent: uninstalling something that was never installed is not an error. */
export function uninstallService(platform = process.platform) {
  if (platform === "darwin") {
    if (!fs.existsSync(MAC_PLIST_PATH)) return { ok: true, removed: false };
    try {
      try { execFileSync("launchctl", ["unload", "-w", MAC_PLIST_PATH], { stdio: "ignore" }); } catch { /* not loaded */ }
      fs.unlinkSync(MAC_PLIST_PATH);
      return { ok: true, removed: true, path: MAC_PLIST_PATH };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  if (platform === "linux") {
    if (!fs.existsSync(LINUX_UNIT_PATH)) return { ok: true, removed: false };
    try {
      try {
        execFileSync("systemctl", ["--user", "disable", "--now", "apx-daemon.service"], { stdio: "ignore" });
      } catch { /* already stopped */ }
      fs.unlinkSync(LINUX_UNIT_PATH);
      try { execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" }); } catch { /* best effort */ }
      return { ok: true, removed: true, path: LINUX_UNIT_PATH };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  if (platform === "win32") {
    try {
      execFileSync("reg", ["delete", WIN_RUN_KEY, "/v", WIN_RUN_NAME, "/f"], { stdio: "ignore" });
      return { ok: true, removed: true, path: `${WIN_RUN_KEY}\\${WIN_RUN_NAME}` };
    } catch {
      return { ok: true, removed: false };
    }
  }

  return { ok: false, error: `service removal not supported on platform: ${platform}` };
}
