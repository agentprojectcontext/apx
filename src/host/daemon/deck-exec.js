// /deck/exec implementation.
//
// All shell spawning sits behind this helper so api/deck.js stays a thin HTTP
// adapter. The OS abstraction is intentionally tiny: pick the "opener" command
// for the platform and pass `target` as a single arg (no shell). For
// app-launching on macOS we use `open -a <App>`.
//
// Stays in host/daemon/ because it's pure process orchestration (spawn child
// processes), not domain logic.
import { spawn } from "node:child_process";

const MAC_APPS = {
  // Whitelisted mac app names. Adding here is the only way the deck can
  // launch something — we never honour a free-form `app` string.
  claude: "Claude",
  chatgpt: "ChatGPT",
  cursor: "Cursor",
  vscode: "Visual Studio Code",
  zen: "Zen Browser",
  terminal: "Terminal",
  iterm: "iTerm",
  finder: "Finder",
};

function platformOpener() {
  if (process.platform === "darwin") return "open";
  if (process.platform === "win32") return "start";
  return "xdg-open";
}

function spawnDetached(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve();
    };
    child.on("error", done);
    // Give the process a tick to fail-fast (bad binary); otherwise detach.
    setTimeout(() => {
      try { child.unref(); } catch {}
      done(null);
    }, 250);
  });
}

/** Pipe `text` into the platform clipboard (pbcopy / xclip / clip). */
export async function copyToClipboard(text) {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "pbcopy" :
    platform === "win32" ? "clip" :
    "xclip";
  const args = platform === "linux" ? ["-selection", "clipboard"] : [];
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    child.stdin.end(text);
  });
}

/**
 * Dispatch one /deck/exec action. `ctx.projects` is the daemon's
 * ProjectManager — used to resolve numeric project ids to absolute paths.
 *
 * Supported kinds:
 *   open_app      { target: "<appKey>" }                        — mac only
 *   open_path     { target: "<absPath>" | "<projectId>" }       — opens in Finder/default
 *   open_path_in  { target: "<projectId>", app: "<appKey>" }    — mac only
 *   open_url      { target: "https://..." }
 *   copy_clipboard { text: "..." }
 */
export async function runDeckExec({ kind, target, appHint, text, ctx }) {
  const platform = process.platform;

  // Resolve a project id (number or "<n>") into an absolute path via
  // the daemon's project manager. Returns null when the id is bogus.
  const projectPath = (idOrPath) => {
    if (!idOrPath) return null;
    const str = String(idOrPath);
    if (str.startsWith("/")) return str;
    if (!/^\d+$/.test(str)) return null;
    const p = ctx.projects?.get?.(parseInt(str, 10));
    return p?.path || null;
  };

  if (kind === "open_app") {
    if (platform !== "darwin") throw new Error("open_app only implemented on macOS for now");
    const appName = MAC_APPS[String(target || "").toLowerCase()];
    if (!appName) throw new Error(`unknown app: ${target}`);
    // Two-step launch:
    //   1. `open -a` ensures the app is running (no-op if already up).
    //   2. AppleScript `activate` brings it to the foreground across
    //      Spaces / Stage Manager, which `open` alone often skips when
    //      the app was already running in the background.
    await spawnDetached("open", ["-a", appName]);
    try {
      await new Promise((resolve) => {
        const child = spawn("osascript", [
          "-e",
          `tell application "${appName}" to activate`,
        ], { stdio: "ignore" });
        child.on("close", () => resolve());
        child.on("error", () => resolve());
        setTimeout(() => { try { child.kill(); } catch {} ; resolve(); }, 600);
      });
    } catch {
      // osascript missing or refused — `open -a` already ran.
    }
    return { app: appName };
  }

  if (kind === "open_path") {
    const resolved = projectPath(target);
    if (!resolved) throw new Error(`open_path: invalid target ${target}`);
    await spawnDetached(platformOpener(), [resolved]);
    return { path: resolved };
  }

  if (kind === "open_path_in") {
    if (platform !== "darwin") throw new Error("open_path_in only implemented on macOS for now");
    const resolved = projectPath(target);
    if (!resolved) throw new Error(`open_path_in: invalid target ${target}`);
    const appName = MAC_APPS[String(appHint || "").toLowerCase()];
    if (!appName) throw new Error(`open_path_in: unknown app ${appHint}`);
    await spawnDetached("open", ["-a", appName, resolved]);
    return { app: appName, path: resolved };
  }

  if (kind === "open_url") {
    if (!target || !/^https?:\/\//i.test(String(target))) {
      throw new Error("open_url: target must be http(s) URL");
    }
    await spawnDetached(platformOpener(), [String(target)]);
    return { url: target };
  }

  if (kind === "copy_clipboard") {
    if (typeof text !== "string") throw new Error("copy_clipboard: text required");
    await copyToClipboard(text);
    return { bytes: text.length };
  }

  throw new Error(`unknown kind: ${kind}`);
}
