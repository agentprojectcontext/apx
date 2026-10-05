// Local transcription made easy: what this machine can run well, which whisper model fits it, and getting that model
// when the owner installs it (downloaded then, not shipped). whisper.cpp's server runs it (see whisper-cpp.ts): with
// Metal on an Apple Silicon Mac, on the CPU elsewhere, where a big model would be too slow.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProgram } from "../programs.ts";

export type LocalModel = {
  id: string;
  /** File size, to show before downloading. */
  mb: number;
  /** Rough speed and quality, for the owner to choose. */
  quality: "basic" | "good" | "great";
};

/** whisper.cpp's own ggml files (huggingface.co/ggerganov/whisper.cpp). Multilingual only: owners write in Spanish. */
export const LOCAL_MODELS: LocalModel[] = [
  { id: "base", mb: 142, quality: "basic" },
  { id: "small", mb: 466, quality: "good" },
  { id: "large-v3-turbo-q5_0", mb: 547, quality: "great" },
];

export type Machine = {
  platform: NodeJS.Platform;
  arch: string;
  cores: number;
  memory_gb: number;
  /** "metal": Apple Silicon's GPU (whisper.cpp from Homebrew uses it); "cpu" anywhere else. */
  accel: "metal" | "cpu";
  /** whisper.cpp's server is installed (where). */
  server?: string | undefined;
  /** ffmpeg converts voice notes for it. */
  ffmpeg: boolean;
};

export function machine(): Machine {
  const accel = process.platform === "darwin" && process.arch === "arm64" ? "metal" : "cpu";
  return {
    platform: process.platform,
    arch: process.arch,
    cores: os.cpus().length,
    memory_gb: Math.round(os.totalmem() / 2 ** 30),
    accel,
    server: findProgram("whisper-server"),
    ffmpeg: Boolean(findProgram("ffmpeg")),
  };
}

/**
 * The model that answers a voice note in seconds here: the big one only with a GPU; on a CPU, `small` when there are
 * cores and memory to spare, `base` otherwise (a VPS, a small laptop).
 */
export function recommend(m: Machine): string {
  if (m.accel === "metal" && m.memory_gb >= 8) return "large-v3-turbo-q5_0";
  if (m.cores >= 8 && m.memory_gb >= 8) return "small";
  return "base";
}

/** How to get whisper.cpp's server on this system, when it is missing. */
export function installHint(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "brew install whisper-cpp ffmpeg";
  if (platform === "win32")
    return "winget install ffmpeg, and whisper-server.exe from github.com/ggml-org/whisper.cpp/releases (in your PATH)";
  return "brew install whisper-cpp ffmpeg (Linuxbrew), or build whisper.cpp; or use a cloud service instead";
}

export const modelFile = (dir: string, id: string) => path.join(dir, `ggml-${id}.bin`);

const STALL_MS = 60_000;

export type Download = { model: string; received: number; total: number; error?: string | undefined };

/** Downloads one model into `dir` (to a .part file first), one at a time, reporting its progress. */
export function createModelInstaller(deps: {
  dir: string;
  base?: string;
  fetchImpl?: typeof fetch;
  /** The model is on disk: set the service up. */
  onReady: (id: string, file: string) => void;
  stallMs?: number;
}) {
  const base = (deps.base ?? "https://huggingface.co/ggerganov/whisper.cpp/resolve/main").replace(/\/$/, "");
  const f = deps.fetchImpl ?? fetch;
  let current: Download | undefined;
  let ac: AbortController | undefined;

  async function run(id: string): Promise<void> {
    const file = modelFile(deps.dir, id);
    const part = `${file}.part`;
    fs.mkdirSync(deps.dir, { recursive: true });
    const abort = new AbortController();
    ac = abort;
    // A connection that stalls is cut after a while without bytes, never waited on forever.
    let stall = setTimeout(() => abort.abort(new Error("the download stalled; try again")), deps.stallMs ?? STALL_MS);
    const alive = () => {
      clearTimeout(stall);
      stall = setTimeout(() => abort.abort(new Error("the download stalled; try again")), deps.stallMs ?? STALL_MS);
    };
    try {
      const res = await f(`${base}/ggml-${id}.bin`, { signal: abort.signal, redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length") ?? 0);
      if (current) current.total = total;
      const out = fs.createWriteStream(part);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        alive();
        if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
        if (current) current.received += value.length;
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      // A cut download is not a model: whisper.cpp would fail on it later, far from the cause.
      if (total && fs.statSync(part).size !== total) throw new Error("the download was cut; try again");
      fs.renameSync(part, file);
      current = undefined;
      deps.onReady(id, file);
    } catch (err) {
      fs.rmSync(part, { force: true });
      const why = abort.signal.aborted && abort.signal.reason instanceof Error ? abort.signal.reason : err;
      if (current) current.error = why instanceof Error ? why.message : String(why);
    } finally {
      clearTimeout(stall);
    }
  }

  return {
    installed: (id: string) => fs.existsSync(modelFile(deps.dir, id)),
    progress: (): Download | undefined => (current ? { ...current } : undefined),
    /** Starts getting a model (a model already on disk is only set up again). */
    install(id: string): void {
      if (!LOCAL_MODELS.some((m) => m.id === id)) throw new Error(`unknown model ${id}`);
      if (current && !current.error) throw new Error(`already downloading ${current.model}`);
      if (fs.existsSync(modelFile(deps.dir, id))) {
        current = undefined;
        deps.onReady(id, modelFile(deps.dir, id));
        return;
      }
      current = { model: id, received: 0, total: 0 };
      void run(id);
    },
    cancel(): void {
      ac?.abort();
    },
  };
}

export type ModelInstaller = ReturnType<typeof createModelInstaller>;
