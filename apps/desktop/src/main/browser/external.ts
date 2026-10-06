// Opens a page in the owner's own browsers (the system default, or one of the installed ones by name).
// Only http(s) leaves the app: the panel cannot hand the OS a file:, custom-scheme or javascript: URL.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";

export type InstalledBrowser = { id: string; name: string };
type Found = InstalledBrowser & { launch: string };

/** id · shown name · macOS app · Windows executable (under Program Files / LocalAppData) · Linux commands. */
const KNOWN: Array<[string, string, string, string, string[]]> = [
  [
    "chrome",
    "Google Chrome",
    "Google Chrome.app",
    "Google/Chrome/Application/chrome.exe",
    ["google-chrome", "google-chrome-stable"],
  ],
  ["safari", "Safari", "Safari.app", "", []],
  ["firefox", "Firefox", "Firefox.app", "Mozilla Firefox/firefox.exe", ["firefox"]],
  ["edge", "Microsoft Edge", "Microsoft Edge.app", "Microsoft/Edge/Application/msedge.exe", ["microsoft-edge"]],
  [
    "brave",
    "Brave",
    "Brave Browser.app",
    "BraveSoftware/Brave-Browser/Application/brave.exe",
    ["brave-browser", "brave"],
  ],
  ["arc", "Arc", "Arc.app", "", []],
  ["chromium", "Chromium", "Chromium.app", "Chromium/Application/chrome.exe", ["chromium", "chromium-browser"]],
  ["vivaldi", "Vivaldi", "Vivaldi.app", "Vivaldi/Application/vivaldi.exe", ["vivaldi"]],
  ["opera", "Opera", "Opera.app", "Opera/opera.exe", ["opera"]],
  ["zen", "Zen", "Zen.app", "", ["zen-browser"]],
];

function locate(app: string, exe: string, commands: string[]): string | undefined {
  if (process.platform === "darwin") {
    if (!app) return undefined;
    return [path.join("/Applications", app), path.join(os.homedir(), "Applications", app)].find((p) =>
      fs.existsSync(p),
    );
  }
  if (process.platform === "win32") {
    if (!exe) return undefined;
    const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA];
    return roots
      .filter(Boolean)
      .map((r) => path.join(r as string, exe))
      .find((p) => fs.existsSync(p));
  }
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const cmd of commands) {
    const hit = dirs.map((d) => path.join(d, cmd)).find((p) => fs.existsSync(p));
    if (hit) return hit;
  }
  return undefined;
}

let cache: Found[] | undefined;

/** The browsers this computer has, looked up once per run (installing one later shows after a restart). */
export function installedBrowsers(): Found[] {
  cache ??= KNOWN.flatMap(([id, name, app, exe, commands]) => {
    const launch = locate(app, exe, commands);
    return launch ? [{ id, name, launch }] : [];
  });
  return cache;
}

export function isWebUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** `browser` undefined = the system default. An unknown id or a non-web URL does nothing. */
export async function openExternal(url: unknown, browser?: unknown): Promise<boolean> {
  if (!isWebUrl(url)) return false;
  if (browser == null) {
    await shell.openExternal(url);
    return true;
  }
  const found = installedBrowsers().find((b) => b.id === browser);
  if (!found) return false;
  if (process.platform === "darwin") {
    execFile("open", ["-a", found.launch, url], () => {});
  } else {
    const child = spawn(found.launch, [url], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  }
  return true;
}
