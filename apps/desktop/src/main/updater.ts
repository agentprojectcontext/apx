// The installed app updates itself (it carries its own core): every few hours it asks the release feed whether a newer
// APX is out and tells the owner once; on their word it downloads this platform's installer, checks its .sha256 and
// puts it in place. Linux (AppImage) and Windows finish on their own; macOS opens the disk image to drag APX in.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  desktopAssetFor,
  fetchReleases,
  newerReleases,
  parseSha256,
  platformOf,
  RELEASE_CHECK_EVERY_MS,
  RELEASE_FEED,
  type Release,
  type ReleaseAsset,
} from "@apx/protocol";
import { app, Notification, shell } from "electron";

export type DesktopUpdate = {
  current: string;
  /** A newer APX with an installer for this computer. */
  latest?: string | undefined;
  notes: string[];
  /** How it goes in: by itself (AppImage, Windows installer), or the owner drags it (macOS disk image). */
  install: "auto" | "drag" | "none";
  checked_at?: string | undefined;
  error?: string | undefined;
};
export type InstallAnswer = { ok: true; restarting: boolean } | { ok: false; error: string };

const FIRST_MS = 60_000;

/** The newest release that has an installer for this platform. */
export function pickUpdate(
  list: unknown,
  current: string,
  platform: string,
  arch: string,
): { release: Release; asset: ReleaseAsset } | undefined {
  const p = platformOf(platform, arch);
  if (!p) return undefined;
  for (const release of newerReleases(list, current)) {
    const asset = desktopAssetFor(release.assets, release.version, p);
    if (asset) return { release, asset };
  }
  return undefined;
}

async function download(url: string, file: string): Promise<void> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20 * 60_000) });
  if (!r.ok || !r.body) throw new Error(`download ${path.basename(file)}: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body as import("node:stream/web").ReadableStream), fs.createWriteStream(file));
}

const digest = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function createDesktopUpdater(opts: { quit(): void }) {
  const env = process.env.APX_RELEASES;
  const feed = env === "off" ? undefined : env || RELEASE_FEED;
  const enabled = app.isPackaged && Boolean(feed) && Boolean(platformOf(process.platform, process.arch));
  // An AppImage replaces itself; run from an unpacked zip, the owner gets the file instead.
  const linuxAuto = process.platform === "linux" && Boolean(process.env.APPIMAGE);
  const mode: DesktopUpdate["install"] =
    process.platform === "darwin" ? "drag" : process.platform === "win32" || linuxAuto ? "auto" : "drag";
  let found: { release: Release; asset: ReleaseAsset } | undefined;
  let status: DesktopUpdate = { current: app.getVersion(), notes: [], install: "none" };
  let told: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function check(): Promise<DesktopUpdate> {
    if (!enabled || !feed) return status;
    try {
      found = pickUpdate(await fetchReleases(feed), app.getVersion(), process.platform, process.arch);
      status = {
        current: app.getVersion(),
        latest: found?.release.version,
        notes: found?.release.notes ?? [],
        install: found ? mode : "none",
        checked_at: new Date().toISOString(),
      };
    } catch (err) {
      status = {
        ...status,
        error: err instanceof Error ? err.message : String(err),
        checked_at: new Date().toISOString(),
      };
    }
    if (status.latest && told !== status.latest && Notification.isSupported()) {
      told = status.latest;
      const es = app.getLocale().startsWith("es");
      new Notification({
        title: "APX",
        body: es
          ? `Salió APX ${status.latest}. Abrí APX para actualizar.`
          : `APX ${status.latest} is out. Open APX to update.`,
      }).show();
    }
    return status;
  }

  async function install(): Promise<InstallAnswer> {
    if (!found) await check();
    if (!found) return { ok: false, error: status.error ?? "No newer APX for this computer." };
    const { release, asset } = found;
    const sum = release.assets.find((a) => a.name === `${asset.name}.sha256`);
    const dir =
      linuxAuto && process.env.APPIMAGE
        ? path.dirname(process.env.APPIMAGE)
        : mode === "drag"
          ? app.getPath("downloads")
          : os.tmpdir();
    const file = path.join(dir, linuxAuto ? `.${asset.name}.download` : asset.name);
    try {
      await download(asset.url, file);
      if (sum) {
        const sumFile = `${file}.sha256`;
        await download(sum.url, sumFile);
        const want = parseSha256(fs.readFileSync(sumFile, "utf8"));
        fs.rmSync(sumFile, { force: true });
        if (!want || want !== digest(file)) throw new Error(`${asset.name} does not match its .sha256`);
      }
    } catch (err) {
      fs.rmSync(file, { force: true });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (linuxAuto && process.env.APPIMAGE) {
      // The running AppImage keeps its open file; the new one takes its name and starts in its place.
      const appImage = process.env.APPIMAGE;
      fs.chmodSync(file, 0o755);
      fs.renameSync(file, appImage);
      app.relaunch({ execPath: appImage, args: [] });
      setTimeout(opts.quit, 300);
      return { ok: true, restarting: true };
    }
    if (process.platform === "win32") {
      // The installer replaces APX once it has quit, then opens the new one (runAfterFinish).
      spawn(file, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
      setTimeout(opts.quit, 1000);
      return { ok: true, restarting: true };
    }
    const opened = await shell.openPath(file);
    if (opened) shell.showItemInFolder(file);
    return { ok: true, restarting: false };
  }

  return {
    status: () => status,
    check,
    install,
    start() {
      if (!enabled) return;
      const tick = (ms: number) => {
        timer = setTimeout(() => void check().finally(() => tick(RELEASE_CHECK_EVERY_MS)), ms);
        timer.unref?.();
      };
      tick(FIRST_MS);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}
