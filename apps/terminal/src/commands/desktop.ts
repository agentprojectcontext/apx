// apx desktop: open the desktop app; without one, fetch this platform's installer from the release feed, check it
// and open it (on Windows it installs and starts the app). apx open: the panel in the default browser.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  desktopAssetFor,
  fetchReleases,
  newerReleases,
  parseSha256,
  platformOf,
  RELEASE_FEED,
  type ReleaseAsset,
} from "@apx/protocol";
import { localConnection } from "./local.ts";

/** Where the installers put the app, per platform, as this machine names them. */
export function desktopCandidates(platform: string, env: NodeJS.ProcessEnv, home = os.homedir()): string[] {
  if (platform === "darwin") return ["/Applications/APX.app", path.posix.join(home, "Applications", "APX.app")];
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local");
    // Builds before 2.2.7 installed into "@apxdesktop" (the package's name); an update keeps the folder it found.
    return [
      path.win32.join(local, "Programs", "apx", "APX.exe"),
      path.win32.join(local, "Programs", "@apxdesktop", "APX.exe"),
    ];
  }
  return [path.posix.join(home, "Applications", "APX.AppImage")];
}

const detached = (cmd: string, args: string[]) =>
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: false }).unref();

/** Opens a file or URL the way the desktop does (Finder, Explorer, xdg-open). */
function openWithSystem(target: string): void {
  if (process.platform === "darwin") detached("open", [target]);
  else if (process.platform === "win32") detached("explorer.exe", [target]);
  else detached("xdg-open", [target]);
}

function launch(app: string): void {
  if (process.platform === "darwin") detached("open", ["-a", app]);
  else detached(app, []);
}

async function download(asset: ReleaseAsset, assets: ReleaseAsset[], dir: string): Promise<string> {
  const sum = assets.find((a) => a.name === `${asset.name}.sha256`);
  if (!sum) throw new Error(`${asset.name} has no .sha256 beside it in the release`);
  const [file, sumText] = await Promise.all([
    fetch(asset.url, { signal: AbortSignal.timeout(10 * 60_000) }).then(async (r) => {
      if (!r.ok) throw new Error(`download ${asset.name}: HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    }),
    fetch(sum.url, { signal: AbortSignal.timeout(30_000) }).then((r) => r.text()),
  ]);
  const want = parseSha256(sumText);
  const got = createHash("sha256").update(file).digest("hex");
  if (!want || want !== got) throw new Error(`${asset.name} does not match its .sha256`);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, asset.name);
  fs.writeFileSync(out, file);
  return out;
}

export async function desktop(): Promise<void> {
  const installed = desktopCandidates(process.platform, process.env).find((p) => fs.existsSync(p));
  if (installed) {
    launch(installed);
    return console.log(`opening ${installed}`);
  }
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
    throw new Error(
      "this machine has no desktop: open the panel from another one (apx expose lan|tailscale, apx pair)",
    );
  const p = platformOf(process.platform, process.arch);
  if (!p) throw new Error(`no desktop app for ${process.platform}-${process.arch}`);
  const feed = process.env.APX_RELEASES || RELEASE_FEED;
  const release = newerReleases(await fetchReleases(feed), "0.0.0").find((r) =>
    desktopAssetFor(r.assets, r.version, p),
  );
  const asset = release && desktopAssetFor(release.assets, release.version, p);
  if (!release || !asset) throw new Error(`no desktop app for ${p.os}-${p.arch} in ${feed}`);
  console.log(`downloading APX ${release.version} for ${p.os}-${p.arch}…`);
  if (p.os === "linux") {
    const app = desktopCandidates("linux", process.env)[0] as string;
    const file = await download(asset, release.assets, path.dirname(app));
    fs.renameSync(file, app);
    fs.chmodSync(app, 0o755);
    launch(app);
    return console.log(`installed ${app}`);
  }
  const file = await download(asset, release.assets, path.join(os.homedir(), "Downloads"));
  // Windows: the installer puts the app in place and starts it. macOS: the disk image opens, to drag APX in.
  if (p.os === "win") detached(file, []);
  else openWithSystem(file);
  console.log(p.os === "win" ? `installing ${file}` : `opened ${file}: drag APX to Applications`);
}

export async function openPanel(): Promise<void> {
  const { url } = localConnection();
  openWithSystem(url);
  console.log(`opening ${url}`);
}
