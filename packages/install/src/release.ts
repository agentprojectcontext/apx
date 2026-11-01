// Updates for a daemon installed from a bundle (install.sh/ps1): the release feed says whether a newer APX is out, and
// on the owner's word the bundle for this platform is downloaded, checked against its .sha256, unpacked beside the one
// running and made `current`. The running version is never touched, so a failed update changes nothing.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  BUNDLE,
  coreBundleName,
  fetchReleases,
  newerReleases,
  type Platform,
  parseSha256,
  type Release,
} from "@apx/protocol";
import { realpath } from "./paths.ts";
import type { Runner } from "./updates.ts";

export type ReleaseCheck = { newer: Release[] };

export async function checkReleases(feed: string, version: string, fetchImpl: typeof fetch): Promise<ReleaseCheck> {
  return { newer: newerReleases(await fetchReleases(feed, fetchImpl), version) };
}

async function download(url: string, file: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<void> {
  const r = await fetchImpl(url, { signal });
  if (!r.ok || !r.body) throw new Error(`download ${path.basename(file)}: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body as import("node:stream/web").ReadableStream), fs.createWriteStream(file));
}

const sha256 = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });

/** System tar avoids a service's restricted PATH on macOS and MSYS drive parsing on Windows. */
const tarCommand = () => {
  if (process.platform === "win32") return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  return process.platform === "darwin" ? "/usr/bin/tar" : "tar";
};

/** Points `current` at a version: a relative symlink swapped in by rename, or a junction on Windows. */
export function switchCurrent(app: string, version: string): void {
  const current = path.join(app, BUNDLE.current);
  const target = path.join(app, BUNDLE.versions, version);
  if (process.platform === "win32") {
    // rmdir removes the junction itself, never what it points at.
    if (fs.existsSync(current)) fs.rmdirSync(current);
    fs.symlinkSync(target, current, "junction");
    return;
  }
  const next = `${current}.${randomUUID().slice(0, 8)}`;
  fs.symlinkSync(path.join(BUNDLE.versions, version), next);
  fs.renameSync(next, current);
}

/**
 * The bundle version a core runs from, when its root is inside `app`. It can differ from `current`: a core that did not
 * restart after an update still runs the version before.
 */
export function runningVersion(app: string, root: string): string | undefined {
  const real = (p: string) => {
    try {
      return realpath(p);
    } catch {
      return path.resolve(p);
    }
  };
  const rel = path.relative(path.join(real(app), BUNDLE.versions), real(root));
  const first = rel.split(path.sep)[0];
  return first && !rel.startsWith("..") && !path.isAbsolute(rel) ? first : undefined;
}

/** Keeps the new version, the one `current` pointed at and the one a core still runs from; older ones go. */
function prune(app: string, keep: string[]): void {
  const versions = path.join(app, BUNDLE.versions);
  for (const v of fs.readdirSync(versions)) {
    if (!keep.includes(v)) fs.rmSync(path.join(versions, v), { recursive: true, force: true });
  }
}

/** The version `current` points at now, if any. */
export function currentVersion(app: string): string | undefined {
  try {
    return path.basename(realpath(path.join(app, BUNDLE.current)));
  } catch {
    return undefined;
  }
}

/** Downloads, checks and unpacks `release` for this platform and makes it current. Returns what it did, for the log. */
export async function installRelease(o: {
  app: string;
  release: Release;
  platform: Platform;
  fetch: typeof fetch;
  run: Runner;
  /** The version this core runs from: never pruned under it. */
  running?: string;
}): Promise<string> {
  const name = coreBundleName(o.release.version, o.platform);
  const asset = o.release.assets.find((a) => a.name === name);
  const sum = o.release.assets.find((a) => a.name === `${name}.sha256`);
  if (!asset || !sum) throw new Error(`APX ${o.release.version} has no ${name} (and its .sha256) for this computer`);

  const work = path.join(o.app, `.update-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(work, { recursive: true });
  try {
    const file = path.join(work, name);
    const signal = AbortSignal.timeout(15 * 60_000);
    await download(asset.url, file, o.fetch, signal);
    await download(sum.url, `${file}.sha256`, o.fetch, signal);
    const want = parseSha256(fs.readFileSync(`${file}.sha256`, "utf8"));
    const got = await sha256(file);
    if (!want || want !== got) throw new Error(`${name} does not match its .sha256 (expected ${want}, got ${got})`);

    const unpacked = path.join(work, "unpacked");
    fs.mkdirSync(unpacked);
    const tar = await o.run(tarCommand(), ["-xzf", file, "-C", unpacked], 5 * 60_000);
    if (tar.code !== 0) throw new Error(`unpacking ${name}: ${tar.out.trim().slice(-300)}`);
    const node = path.join(unpacked, "apx", ...BUNDLE.node(o.platform.os === "win"));
    if (!fs.existsSync(node)) throw new Error(`${name} has no Node inside`);

    const before = currentVersion(o.app);
    const target = path.join(o.app, BUNDLE.versions, o.release.version);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(path.join(unpacked, "apx"), target);
    switchCurrent(o.app, o.release.version);
    prune(o.app, [o.release.version, ...(before ? [before] : []), ...(o.running ? [o.running] : [])]);
    return `downloaded ${name}, checked its sha256, installed it as current${before ? ` (was ${before})` : ""}`;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
