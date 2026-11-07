// Starts the owner's Chrome when their turn asks for it and APX's extension is not connected: the extension connects
// by itself once its browser runs, so the agent opens it instead of sending the owner to. See DECISIONS.md#d-198
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CHROME_EXTENSION_ID } from "@apx/protocol";

/** What opening the owner's Chrome came to. */
export type ChromeOpen = "opened" | "no_extension" | "failed";

// Keyed by the end of each data folder browserDataDirs lists: the app that owns it.
const MAC_APPS: Record<string, string> = {
  "Google/Chrome": "com.google.Chrome",
  "Google/Chrome Beta": "com.google.Chrome.beta",
  "Google/Chrome Canary": "com.google.Chrome.canary",
  "Application Support/Chromium": "org.chromium.Chromium",
  "BraveSoftware/Brave-Browser": "com.brave.Browser",
  "Application Support/Microsoft Edge": "com.microsoft.edgemac",
  "Arc/User Data": "company.thebrowser.Browser",
};
const LINUX_APPS: Record<string, string> = {
  ".config/google-chrome": "google-chrome",
  ".config/google-chrome-beta": "google-chrome-beta",
  ".config/chromium": "chromium",
  "BraveSoftware/Brave-Browser": "brave-browser",
  ".config/microsoft-edge": "microsoft-edge",
};

const tail = (dir: string) => dir.split(path.sep).slice(-2).join("/");

/** Whether a profile of this browser has APX's extension (installed, or loaded from a folder). */
export function hasApxExtension(dataDir: string): boolean {
  let entries: string[];
  try {
    entries = fs.readdirSync(dataDir);
  } catch {
    return false;
  }
  return entries
    .filter((e) => e === "Default" || e.startsWith("Profile "))
    .some((profile) =>
      ["Secure Preferences", "Preferences"].some((file) => {
        try {
          return fs.readFileSync(path.join(dataDir, profile, file), "utf8").includes(CHROME_EXTENSION_ID);
        } catch {
          return false;
        }
      }),
    );
}

export type Launch = (cmd: string, args: string[]) => Promise<void>;

const launch: Launch = (cmd, args) =>
  new Promise((resolve, reject) => {
    if (cmd === "open") {
      execFile(cmd, args, { timeout: 5_000 }, (err) => (err ? reject(err) : resolve()));
      return;
    }
    // A browser started on Linux outlives the core: detached, its output nowhere.
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

/**
 * Opens the first browser (in browserDataDirs' order, Chrome first) whose profile has APX's extension. A browser
 * already running is only brought forward. Windows is not served yet, like the extension's host.
 */
export async function openOwnersChrome(opts: {
  browsers: readonly string[];
  platform?: NodeJS.Platform;
  run?: Launch;
}): Promise<ChromeOpen> {
  const platform = opts.platform ?? process.platform;
  const apps = platform === "darwin" ? MAC_APPS : platform === "linux" ? LINUX_APPS : undefined;
  if (!apps) return "failed";
  const withExtension = opts.browsers.filter((dir) => apps[tail(dir)] && hasApxExtension(dir));
  if (!withExtension.length) return "no_extension";
  const run = opts.run ?? launch;
  for (const dir of withExtension) {
    const app = apps[tail(dir)] as string;
    try {
      await (platform === "darwin" ? run("open", ["-b", app]) : run(app, []));
      return "opened";
    } catch {}
  }
  return "failed";
}
