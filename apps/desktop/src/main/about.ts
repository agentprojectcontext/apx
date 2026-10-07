// APX's own About window: this build's versions, credits and the repo, instead of the system panel
// (which, run from a checkout, shows Electron's version).
import { app, BrowserWindow, shell } from "electron";
import { APP_SCHEME } from "./app-scheme.ts";
import { isWebUrl } from "./browser/external.ts";

const SYSTEMS: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

/** Set by the bundler (scripts/build.ts): the release's tag, or in a checkout the last tag and commits past it. */
declare const APX_VERSION: string;

let win: BrowserWindow | undefined;

type Health = { started_at?: string; subsystems?: Record<string, { status: string }> };

/** The core's own report (`/health` is open), for the window's list; nothing when it does not answer quickly. */
async function coreHealth(coreUrl: string): Promise<Health | undefined> {
  try {
    const res = await fetch(new URL("/health", coreUrl), { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { ok?: boolean; result?: Health };
    return body.ok ? body.result : undefined;
  } catch {
    return undefined;
  }
}

export async function showAbout(partition: string, coreUrl: string): Promise<void> {
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 780,
    height: 450,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "APX",
    backgroundColor: "#161616",
    show: false,
    webPreferences: { partition, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win?.show());
  // Its only link (the repo) opens in the system browser; the window itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      e.preventDefault();
      win?.close();
    }
  });
  // A checkout's package.json version is a placeholder; releases set the real one from their tag.
  const version = app.isPackaged ? app.getVersion() : APX_VERSION;
  const health = await coreHealth(coreUrl);
  const query = new URLSearchParams({
    v: version,
    electron: process.versions.electron,
    os: `${SYSTEMS[process.platform] ?? process.platform} ${process.getSystemVersion()} · ${process.arch}`,
    core: new URL(coreUrl).host,
  });
  if (health?.started_at) query.set("since", health.started_at);
  if (health?.subsystems)
    query.set(
      "services",
      Object.entries(health.subsystems)
        .map(([name, sub]) => `${name}:${sub.status}`)
        .join(","),
    );
  if (win.isDestroyed()) return;
  void win.loadURL(`${APP_SCHEME}://app/index.html?about&${query}`);
}
