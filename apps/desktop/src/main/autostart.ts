// Starting with the computer. macOS and Windows have it in Electron; Linux desktops read an XDG autostart entry.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

/** What a Linux login starts: the AppImage itself when APX runs from one (its mount path changes every run). */
export function linuxEntry(exec: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=APX",
    `Exec="${exec}"`,
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export function setLaunchAtLogin(on: boolean): void {
  if (!app.isPackaged) return;
  if (process.platform !== "linux") {
    app.setLoginItemSettings({ openAtLogin: on });
    return;
  }
  const file = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "autostart", "apx.desktop");
  try {
    if (on) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, linuxEntry(process.env.APPIMAGE || process.execPath));
    } else fs.rmSync(file, { force: true });
  } catch {
    // a read-only home: APX still runs, it just will not start by itself
  }
}
