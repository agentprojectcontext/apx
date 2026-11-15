// ffmpeg for voice notes and voice replies: the one on this computer, or else a static build APX downloads into its
// own folder the first time it needs one, since an installed app does not bring it. See DECISIONS.md#d-231.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { findProgram } from "../programs.ts";

const RELEASE = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1";
const DOWNLOAD_MS = 10 * 60_000;

/** The gzipped build for each system, with the sha256 its release publishes. */
const BUILDS: Record<string, string> = {
  "darwin-arm64": "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa",
  "darwin-x64": "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106",
  "linux-arm64": "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0",
  "linux-x64": "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa",
  "win32-x64": "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77",
};

export type Ffmpeg = {
  /** The program to run, downloading it first when this computer has none. */
  path(): Promise<string>;
};

export function createFfmpeg(deps: {
  /** Where a downloaded build is kept. */
  dir: string;
  log: Log;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  /** The program already on this computer (PATH and where package managers put it). */
  find?: (name: string) => string | undefined;
  base?: string;
}): Ffmpeg {
  const system = `${deps.platform ?? process.platform}-${deps.arch ?? process.arch}`;
  const file = path.join(deps.dir, system.startsWith("win32") ? "ffmpeg.exe" : "ffmpeg");
  let pending: Promise<string> | undefined;

  async function download(): Promise<string> {
    const sha = BUILDS[system];
    if (!sha) throw new Error(`no ffmpeg build for ${system}; install ffmpeg to hear voice notes`);
    deps.log.info({ system }, "downloading ffmpeg");
    const res = await (deps.fetchImpl ?? fetch)(`${deps.base ?? RELEASE}/ffmpeg-${system}.gz`, {
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_MS),
    });
    if (!res.ok) throw new Error(`ffmpeg download: HTTP ${res.status}`);
    const gz = Buffer.from(await res.arrayBuffer());
    if (crypto.createHash("sha256").update(gz).digest("hex") !== sha)
      throw new Error("ffmpeg download: the file is not the published build");
    fs.mkdirSync(deps.dir, { recursive: true });
    const part = `${file}.part`;
    fs.writeFileSync(part, zlib.gunzipSync(gz), { mode: 0o755 });
    fs.renameSync(part, file);
    deps.log.info({ system }, "ffmpeg ready");
    return file;
  }

  return {
    path() {
      const found = (deps.find ?? findProgram)("ffmpeg");
      if (found) return Promise.resolve(found);
      if (fs.existsSync(file)) return Promise.resolve(file);
      // One download at a time; a failed one is tried again on the next recording.
      pending ??= download().catch((err) => {
        pending = undefined;
        deps.log.warn({ err: errorMessage(err, 200) }, "ffmpeg not downloaded");
        throw err;
      });
      return pending;
    },
  };
}
