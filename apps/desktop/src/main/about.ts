// APX's own About window: this build's versions, credits and the repo, instead of the system panel
// (which, run from a checkout, shows Electron's version).
import { app, BrowserWindow, shell } from "electron";
import { APP_SCHEME } from "./app-scheme.ts";
import { isWebUrl } from "./browser/external.ts";

const SYSTEMS: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

/** Set by the bundler (scripts/build.ts): the release's tag, or in a checkout the last tag and commits past it. */
declare const APX_VERSION: string;

let win: BrowserWindow | undefined;

export function showAbout(partition: string): void {
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 620,
    height: 400,
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
  const query = new URLSearchParams({
    v: version,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    os: `${SYSTEMS[process.platform] ?? process.platform} ${process.getSystemVersion()} · ${process.arch}`,
  });
  void win.loadURL(`${APP_SCHEME}://app/index.html?about&${query}`);
}
