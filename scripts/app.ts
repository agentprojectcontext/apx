#!/usr/bin/env node
// `pnpm app`: builds the panel and the desktop shell, starts the core (which serves the panel) and opens the app.
// Ctrl+C stops both.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const step = (args: string[]) => {
  const r = spawnSync("pnpm", args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
step(["--filter", "@apx/ui", "build"]);
step(["--filter", "@apx/web", "build"]);
step(["--filter", "@apx/desktop", "build"]);

// The core asks to be started again after it updated itself (exit code 75: the new code is on disk).
const RESTART_CODE = 75;
let core = startCore();
function startCore() {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "apps/core/src/main.ts"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, APX_SUPERVISED: "1" },
  });
  child.on("exit", (code) => {
    if (code === RESTART_CODE) core = startCore();
  });
  return child;
}
await new Promise((r) => setTimeout(r, 1500));
const electron = devBundle() ?? path.join(root, "apps/desktop/node_modules/.bin/electron");
const desktop = spawn(electron, ["."], {
  cwd: path.join(root, "apps/desktop"),
  stdio: "inherit",
  env: { ...process.env, APX_WEB_URL: process.env.APX_WEB_URL ?? "http://127.0.0.1:7440" },
});
const stop = () => {
  desktop.kill();
  core.kill();
};
desktop.on("exit", () => {
  core.kill();
  process.exit(0);
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

/**
 * macOS names the app (menu bar, Dock, ⌘-Tab) and draws its icon from the bundle that runs. Electron's own bundle says
 * "Electron", so a copy named APX with APX's icon runs instead: an APFS clone (no space), rebuilt when Electron
 * changes. Elsewhere, or if anything fails, Electron runs as it is.
 */
function devBundle(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const desktop = path.join(root, "apps/desktop");
    const source = path.join(path.dirname(electronPackage(desktop)), "dist", "Electron.app");
    const app = path.join(desktop, ".dev", "APX.app");
    const stamp = path.join(desktop, ".dev", "electron-version");
    const version = fs.readFileSync(path.join(source, "Contents", "Info.plist"), "utf8");
    if (!fs.existsSync(app) || fs.readFileSync(stamp, "utf8") !== version) {
      fs.rmSync(path.dirname(app), { recursive: true, force: true });
      fs.mkdirSync(path.dirname(app), { recursive: true });
      const cloned = spawnSync("cp", ["-Rc", source, app]).status === 0;
      if (!cloned && spawnSync("cp", ["-R", source, app]).status !== 0) return undefined;
      const plist = path.join(app, "Contents", "Info.plist");
      for (const key of ["CFBundleName", "CFBundleDisplayName"])
        spawnSync("plutil", ["-replace", key, "-string", "APX", plist]);
      const icns = makeIcns(path.join(desktop, "assets", "icon.png"), path.join(desktop, ".dev"));
      if (icns) fs.copyFileSync(icns, path.join(app, "Contents", "Resources", "electron.icns"));
      fs.writeFileSync(stamp, version);
    }
    return path.join(app, "Contents", "MacOS", "Electron");
  } catch {
    return undefined;
  }
}

/** The electron package's folder, as installed for the desktop app. */
function electronPackage(desktop: string): string {
  return fs.realpathSync(path.join(desktop, "node_modules", "electron", "package.json"));
}

/** A .icns from the APX logo (sips + iconutil, both part of macOS). */
function makeIcns(png: string, dir: string): string | undefined {
  const set = path.join(dir, "APX.iconset");
  fs.mkdirSync(set, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    spawnSync("sips", ["-z", String(size), String(size), png, "--out", path.join(set, `icon_${size}x${size}.png`)]);
    spawnSync("sips", [
      "-z",
      String(size * 2),
      String(size * 2),
      png,
      "--out",
      path.join(set, `icon_${size}x${size}@2x.png`),
    ]);
  }
  const out = path.join(dir, "APX.icns");
  return spawnSync("iconutil", ["-c", "icns", set, "-o", out]).status === 0 ? out : undefined;
}
