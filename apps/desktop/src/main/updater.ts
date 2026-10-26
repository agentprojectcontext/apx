// The installed app updates itself (it carries its own core): every few hours it asks the release feed whether a newer
// APX is out, downloads this platform's build, checks its .sha256 and leaves it ready; it goes in when the owner
// restarts APX, or when they quit it. macOS replaces its own APX.app from the release's zip; the AppImage replaces its
// file; Windows runs the installer. Where the app cannot replace itself (a read-only place, an unpacked Linux zip),
// the owner gets the installer to put in by hand. See DECISIONS.md#d-058.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
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
  releaseChanges,
} from "@apx/protocol";
import { app, shell } from "electron";
import { replaceableBundle } from "./app-bundle.ts";
import { removeOldInstallers } from "./installer-files.ts";

export type DesktopUpdate = {
  current: string;
  /** A newer APX with a build for this computer. */
  latest?: string | undefined;
  notes: string[];
  /** How it goes in: by itself at the next restart (auto), or the owner drags it in (macOS disk image). */
  install: "auto" | "drag" | "none";
  /** Downloading the newer APX now. */
  downloading?: boolean | undefined;
  /** The newer APX, downloaded and checked: it goes in when APX restarts. */
  ready?: string | undefined;
  checked_at?: string | undefined;
  error?: string | undefined;
};
export type InstallAnswer = { ok: true; ready: boolean } | { ok: false; error: string };

const FIRST_MS = 60_000;
const run = promisify(execFile);

/**
 * The newest release that has an installer for this platform, and what it and the others since `current` change (a
 * release whose notes are only a changelog link still shows the ones before it).
 */
export function pickUpdate(
  list: unknown,
  current: string,
  platform: string,
  arch: string,
): { release: Release; asset: ReleaseAsset; notes: string[] } | undefined {
  const p = platformOf(platform, arch);
  if (!p) return undefined;
  const newer = newerReleases(list, current);
  for (const [i, release] of newer.entries()) {
    const asset = desktopAssetFor(release.assets, release.version, p);
    if (asset) return { release, asset, notes: releaseChanges(newer.slice(i)) };
  }
  return undefined;
}

const writable = (dir: string) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

async function download(url: string, file: string): Promise<void> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20 * 60_000) });
  if (!r.ok || !r.body) throw new Error(`download ${path.basename(file)}: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body as import("node:stream/web").ReadableStream), fs.createWriteStream(file));
}

const digest = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Downloads an asset and, when the release carries its .sha256, checks it; a bad file is removed. */
async function fetchChecked(release: Release, asset: ReleaseAsset, file: string): Promise<void> {
  const sum = release.assets.find((a) => a.name === `${asset.name}.sha256`);
  try {
    if (!sum) throw new Error(`${asset.name} has no .sha256`);
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
    throw err;
  }
}

// Swaps APX.app once APX (and the core it runs from inside the bundle) has quit; puts the old one back if that fails.
const SWAP = `
pid="$1"; old="$2"; new="$3"; stage="$4"; relaunch="$5"
i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done
i=0; while pgrep -f "$old/Contents/" >/dev/null 2>&1 && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done
if mv "$old" "$stage/previous.app"; then
  if mv "$new" "$old"; then rm -rf "$stage"; else mv "$stage/previous.app" "$old"; fi
fi
if [ "$relaunch" = 1 ]; then open "$old"; fi
`;

type Staged = { version: string; restart(): void; onQuit?(): void };

export function createDesktopUpdater(opts: { quit(): void; changed(status: DesktopUpdate): void }) {
  const env = process.env.APX_RELEASES;
  const feed = env === "off" ? undefined : env || RELEASE_FEED;
  const enabled = app.isPackaged && Boolean(feed) && Boolean(platformOf(process.platform, process.arch));
  const bundle = process.platform === "darwin" ? replaceableBundle(process.execPath, writable) : undefined;
  // An AppImage replaces itself; run from an unpacked zip, the owner gets the file instead.
  const appImage = process.platform === "linux" ? process.env.APPIMAGE : undefined;
  const mode: DesktopUpdate["install"] = process.platform === "win32" || bundle || appImage ? "auto" : "drag";
  let found: ReturnType<typeof pickUpdate>;
  let status: DesktopUpdate = { current: app.getVersion(), notes: [], install: "none" };
  let staged: Staged | undefined;
  let downloading: Promise<InstallAnswer> | undefined;
  let swapping = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const current = (): DesktopUpdate => ({ ...status, downloading: Boolean(downloading), ready: staged?.version });
  const publish = () => opts.changed(current());

  async function check(): Promise<DesktopUpdate> {
    if (!enabled || !feed) return current();
    try {
      found = pickUpdate(await fetchReleases(feed), app.getVersion(), process.platform, process.arch);
      status = {
        current: app.getVersion(),
        latest: found?.release.version,
        notes: found?.notes ?? [],
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
    publish();
    return current();
  }

  /** Downloads the newer APX and leaves it ready (or, where it cannot go in by itself, opens it for the owner). */
  function install(target?: string, deferOpen = false): Promise<InstallAnswer> {
    if (!enabled) return Promise.resolve({ ok: false, error: "No newer APX for this computer." });
    if (staged && staged.version === (target ?? staged.version)) return Promise.resolve({ ok: true, ready: true });
    staged = undefined;
    const started = generation;
    downloading ??= prepare(target, deferOpen)
      .then((answer) => {
        if (started !== generation) {
          staged = undefined;
          return { ok: false as const, error: "The APX connection changed. Retry the update." };
        }
        return answer;
      })
      .finally(() => {
        downloading = undefined;
        publish();
      });
    publish();
    return downloading;
  }

  async function prepare(target?: string, deferOpen = false): Promise<InstallAnswer> {
    if (target && feed) {
      const release = newerReleases(await fetchReleases(feed), "0.0.0").find((r) => r.version === target);
      const platform = platformOf(process.platform, process.arch);
      const asset = release && platform ? desktopAssetFor(release.assets, target, platform) : undefined;
      if (!release || !asset) return { ok: false, error: "The selected release has no installer for this computer." };
      found = { release, asset, notes: release.notes };
    }
    if (!found) await check();
    if (!found) return { ok: false, error: status.error ?? "No newer APX for this computer." };
    const { release, asset } = found;
    const p = platformOf(process.platform, process.arch);
    const zip = bundle && p ? desktopAssetFor(release.assets, release.version, p, "zip") : undefined;
    try {
      if (bundle && zip) staged = await stageMac(release, zip, bundle);
      else if (appImage) staged = await stageAppImage(release, asset, appImage);
      else if (process.platform === "win32") staged = await stageWindows(release, asset);
      else {
        const file = path.join(app.getPath("downloads"), asset.name);
        await fetchChecked(release, asset, file);
        const open = async () => {
          const opened = await shell.openPath(file);
          if (opened) shell.showItemInFolder(file);
        };
        if (deferOpen) {
          staged = {
            version: release.version,
            restart: () => {
              void open();
            },
          };
          return { ok: true, ready: true };
        }
        await open();
        return { ok: true, ready: false };
      }
      return { ok: true, ready: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function stageMac(release: Release, zip: ReleaseAsset, old: string): Promise<Staged> {
    // Beside the running app, so the swap is a rename on the same disk.
    const stage = path.join(path.dirname(old), `.APX-${release.version}.update`);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage);
    const file = path.join(os.tmpdir(), zip.name);
    try {
      await fetchChecked(release, zip, file);
      await run("/usr/bin/ditto", ["-x", "-k", file, stage]);
    } catch (err) {
      fs.rmSync(stage, { recursive: true, force: true });
      throw err;
    } finally {
      fs.rmSync(file, { force: true });
    }
    const name = fs.readdirSync(stage).find((f) => f.endsWith(".app"));
    if (!name) {
      fs.rmSync(stage, { recursive: true, force: true });
      throw new Error(`${zip.name} has no app in it`);
    }
    const next = path.join(stage, name);
    await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", next]).catch(() => undefined);
    const swap = (relaunch: boolean) => {
      swapping = true;
      spawn("/bin/sh", ["-c", SWAP, "apx-update", String(process.pid), old, next, stage, relaunch ? "1" : "0"], {
        detached: true,
        stdio: "ignore",
      }).unref();
    };
    return {
      version: release.version,
      restart: () => {
        swap(true);
        opts.quit();
      },
      onQuit: () => swap(false),
    };
  }

  async function stageAppImage(release: Release, asset: ReleaseAsset, target: string): Promise<Staged> {
    const file = path.join(path.dirname(target), `.${asset.name}.download`);
    await fetchChecked(release, asset, file);
    // Keep the verified bytes separate until the native coordinator authorizes activation.
    fs.chmodSync(file, 0o755);
    let applied = false;
    const activate = () => {
      if (applied) return;
      fs.renameSync(file, target);
      applied = true;
    };
    return {
      version: release.version,
      restart: () => {
        activate();
        app.relaunch({ execPath: target, args: [] });
        opts.quit();
      },
      onQuit: activate,
    };
  }

  async function stageWindows(release: Release, asset: ReleaseAsset): Promise<Staged> {
    const file = path.join(os.tmpdir(), asset.name);
    removeOldInstallers(os.tmpdir(), asset.name);
    await fetchChecked(release, asset, file);
    return {
      version: release.version,
      // The installer replaces APX once it has quit, then opens the new one (runAfterFinish).
      restart: () => {
        spawn(file, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
        setTimeout(opts.quit, 1000);
      },
    };
  }

  return {
    enabled,
    mode,
    status: current,
    check,
    install,
    discard() {
      generation++;
      staged = undefined;
      publish();
    },
    /** Quits and opens the newer APX. */
    restart() {
      staged?.restart();
    },
    /** Quitting with a newer APX ready puts it in place (where that needs no installer window). */
    quitting() {
      if (staged?.onQuit && !swapping) staged.onQuit();
    },
    /** `found(status)`: a background check found a newer APX (auto mode then downloads it on its own). */
    start(found: (s: DesktopUpdate) => void) {
      if (!enabled) return;
      // Running means the last installer is done: it and any before it go.
      if (process.platform === "win32") removeOldInstallers(os.tmpdir());
      if (bundle)
        for (const f of fs.readdirSync(path.dirname(bundle)))
          if (/^\.APX-.+\.update$/.test(f))
            fs.rmSync(path.join(path.dirname(bundle), f), { recursive: true, force: true });
      const tick = (ms: number) => {
        timer = setTimeout(
          () =>
            void check()
              .then((s) => {
                if (s.latest && !s.ready && !s.downloading) found(s);
              })
              .finally(() => tick(RELEASE_CHECK_EVERY_MS)),
          ms,
        );
        timer.unref?.();
      };
      tick(FIRST_MS);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}
