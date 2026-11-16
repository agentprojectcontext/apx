// uv runs APX's own voice: the one on this computer, or else the build APX downloads into its own folder, so a Mac
// that got APX from its installer has a voice without a terminal. See DECISIONS.md#d-236.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { findProgram } from "../programs.ts";

const RELEASE = "https://github.com/astral-sh/uv/releases/download/0.13.8";
const DOWNLOAD_MS = 10 * 60_000;

/** The archive for each system the voice runs on, with the sha256 its release publishes. */
const BUILDS: Record<string, { name: string; sha: string }> = {
  "darwin-arm64": {
    name: "uv-aarch64-apple-darwin",
    sha: "6b71028a6b904f2ae3340ef52e595512de807d06c0a20eaef2f692581b246558",
  },
};

export type Uv = {
  /** uv already here (on this computer or downloaded before), without downloading. */
  now(): string | undefined;
  /** Whether this computer can get uv by downloading it. */
  downloadable: boolean;
  /** uv, downloading it first when this computer has none. */
  path(): Promise<string>;
};

export function createUv(deps: {
  /** Where a downloaded build is kept. */
  dir: string;
  log: Log;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  /** The program already on this computer (PATH and where package managers put it). */
  find?: (name: string) => string | undefined;
  base?: string;
  /** The archive and its sha256, instead of this system's published one. */
  build?: { name: string; sha: string };
}): Uv {
  const system = `${deps.platform ?? process.platform}-${deps.arch ?? process.arch}`;
  const build = deps.build ?? BUILDS[system];
  const file = path.join(deps.dir, "uv");
  let pending: Promise<string> | undefined;

  const now = () => (deps.find ?? findProgram)("uv") ?? (fs.existsSync(file) ? file : undefined);

  async function download(): Promise<string> {
    if (!build) throw new Error(`no uv build for ${system}`);
    deps.log.info({ system }, "downloading uv");
    const res = await (deps.fetchImpl ?? fetch)(`${deps.base ?? RELEASE}/${build.name}.tar.gz`, {
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_MS),
    });
    if (!res.ok) throw new Error(`uv download: HTTP ${res.status}`);
    const gz = Buffer.from(await res.arrayBuffer());
    if (crypto.createHash("sha256").update(gz).digest("hex") !== build.sha)
      throw new Error("uv download: the file is not the published build");
    const program = fromTar(zlib.gunzipSync(gz), `${build.name}/uv`);
    if (!program) throw new Error("uv download: the archive has no uv");
    fs.mkdirSync(deps.dir, { recursive: true });
    const part = `${file}.part`;
    fs.writeFileSync(part, program, { mode: 0o755 });
    fs.renameSync(part, file);
    deps.log.info({ system }, "uv ready");
    return file;
  }

  return {
    now,
    downloadable: Boolean(build),
    path() {
      const found = now();
      if (found) return Promise.resolve(found);
      // One download at a time; a failed one is tried again the next time the voice is asked for.
      pending ??= download().catch((err) => {
        pending = undefined;
        deps.log.warn({ err: errorMessage(err, 200) }, "uv not downloaded");
        throw err;
      });
      return pending;
    },
  };
}

/** One file's bytes from a tar archive (512-byte ustar headers, each file padded to 512). */
export function fromTar(tar: Buffer, name: string): Buffer | undefined {
  const text = (at: number, len: number) =>
    tar
      .subarray(at, at + len)
      .toString("utf8")
      .replace(/\0.*$/s, "");
  for (let at = 0; at + 512 <= tar.length; ) {
    const base = text(at, 100);
    if (!base) return undefined;
    const prefix = text(at + 345, 155);
    const size = Number.parseInt(text(at + 124, 12).trim() || "0", 8);
    const full = (prefix ? `${prefix}/${base}` : base).replace(/^\.\//, "");
    if (full === name) return Buffer.from(tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return undefined;
}
