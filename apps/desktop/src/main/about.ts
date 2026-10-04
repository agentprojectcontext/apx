// APX's own About window: the first run's animated hero with this build's version, instead of the system panel
// (which, run from a checkout, shows Electron's version).
import { app, BrowserWindow } from "electron";
import { APP_SCHEME } from "./app-scheme.ts";

let win: BrowserWindow | undefined;

export function showAbout(partition: string): void {
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 560,
    height: 460,
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
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      e.preventDefault();
      win?.close();
    }
  });
  // A checkout's version is the repo's placeholder; releases set the real one from their tag.
  const version = app.isPackaged ? app.getVersion() : `${app.getVersion()}-dev`;
  void win.loadURL(`${APP_SCHEME}://app/index.html?about&v=${encodeURIComponent(version)}`);
}
