// APX's own voice (voice/engine.py), run by APX itself: it speaks the agents' voice notes, transcribes recordings and
// carries calls. Started when one of those needs it, stopped after a while unused so its models leave memory, listening
// on loopback only behind a secret. It needs uv, which brings its Python and packages, and Apple silicon (its models
// run on MLX). See DECISIONS.md#d-227
import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { VoiceMissing, VoiceQuality, VoiceTier } from "@apx/protocol";
import WebSocket from "ws";
import type { Log } from "../log.ts";
import { isInside } from "../paths.ts";
import { findProgram } from "../programs.ts";
import type { Uv } from "./uv.ts";
import { voiceProcessEnv } from "./voice-process-env.ts";

const START_TIMEOUT_MS = 5 * 60_000; // the first start after an update installs Python packages
const IDLE_MS = 10 * 60_000;
const SPEAK_TIMEOUT_MS = 90_000;
const ENGINE = path.join(import.meta.dirname, "../voice/engine.py");

/**
 * Below MIN_GB the voice does not run. On its own it runs the larger models from AUTO_FULL_GB: with less, the 6 GB
 * they take with everything else open sent them to swap and the voice slowed tenfold. The owner may pick them from
 * FULL_GB.
 */
const MIN_GB = 8;
/** The models in voice/speech.py MODELS: a new one makes a machine that has the old ones download it first. */
const MODELS_REV = 2;
/** The models of each tier as the owner reads them (speech.py MODELS), and about what they download together. */
const MODEL_NAMES = {
  light: { speaks: "Qwen3-TTS 0.6B", hears: "Whisper large-v3 turbo, 4-bit (MLX)", size_gb: 3, hears_gb: 0.6 },
  full: { speaks: "Qwen3-TTS 1.7B", hears: "Whisper large-v3 turbo (MLX)", size_gb: 6, hears_gb: 1.8 },
} as const;
const FULL_GB = 16;
const AUTO_FULL_GB = 32;

export type VoiceMachine = { tier: VoiceTier; memory_gb: number; missing?: VoiceMissing | undefined };

/** What a download brings: every model, or (`ears`) only what hears, for transcription without APX speaking. */
export type VoicePart = "all" | "ears";
export type Install = {
  state: "downloading" | "failed";
  received: number;
  total: number;
  error?: string | undefined;
  part?: VoicePart | undefined;
};

/** What one call tells the engine: the voice, the accent, who talks and who is called. */
export type CallSetup = {
  voice: "female" | "male";
  locale: "es-AR" | "es" | "en-US";
  /** `quick`: a request said by name, answered in a few words; the voice hangs up once answered. */
  mode: "call" | "quick";
  owner: string;
  agent: string;
  /** How the voice presents itself ("Acme's personal assistant in APX"), and what its agent can reach. */
  who: string;
  reach: string;
  /** The agents' names, for transcription. */
  names: string;
};

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });

type Running = {
  child: ChildProcess;
  url: string;
  secret: string;
  ready: Promise<void>;
  /** It answered its health check: started, not starting. */
  up?: boolean;
  used: number;
  calls: number;
  /** Started with models the owner has since changed: stopped once no call uses it. */
  stale?: boolean;
};

export function createVoiceEngine(deps: {
  log: Log;
  /** CPU turn taking with speech and transcription provided over the private call socket. */
  services?: boolean;
  /** APX's home: the engine logs to <home>/logs/voice.log. */
  home: string;
  /** The owner's name, for the greeting. */
  owner?: () => string;
  idleMs?: number;
  platform?: NodeJS.Platform;
  arch?: string;
  memoryGb?: number;
  /** The models the owner picked (auto: by this Mac's memory). */
  quality?: () => VoiceQuality;
  spawn?: typeof spawn;
  uv?: () => string | undefined;
  /** uv APX downloads where this Mac has none (DECISIONS.md#d-236). */
  uvProgram?: Uv;
}) {
  let current: Running | undefined;
  let install: Install | undefined;
  const uv = () => (deps.uv ?? (() => (deps.uvProgram ? deps.uvProgram.now() : findProgram("uv"))))();
  /** uv now, or downloaded first where APX can get it. */
  const getUv = async () => {
    const bin = uv() ?? (await deps.uvProgram?.path());
    if (!bin) throw new Error("uv is not installed (brew install uv)");
    return bin;
  };
  const run = deps.spawn ?? spawn;

  function machine(): VoiceMachine {
    const memory_gb = deps.memoryGb ?? Math.round(os.totalmem() / 2 ** 30);
    if (deps.services)
      return {
        tier: "light",
        memory_gb,
        ...(!uv() && !deps.uvProgram?.downloadable ? { missing: "uv" as const } : {}),
      };
    if ((deps.platform ?? process.platform) !== "darwin" || (deps.arch ?? process.arch) !== "arm64")
      return { tier: "none", memory_gb, missing: "platform" };
    if (memory_gb < MIN_GB) return { tier: "none", memory_gb, missing: "memory" };
    const q = deps.quality?.() ?? "auto";
    const full = q === "full" ? memory_gb >= FULL_GB : q === "auto" && memory_gb >= AUTO_FULL_GB;
    const noUv = !uv() && !deps.uvProgram?.downloadable;
    return { tier: full ? "full" : "light", memory_gb, ...(noUv ? { missing: "uv" as const } : {}) };
  }

  // What the engine needs from the core's environment, and nothing else: never APX's token or any key.
  const env = (extra: Record<string, string>, tier = machine().tier) => ({
    ...voiceProcessEnv(process.env),
    VOICE_TIER: tier,
    VOICE_PARENT_PID: String(process.pid),
    VOICE_OWNER: deps.owner?.() ?? "",
    // The owner's own recordings, used before APX's voices of the same name (es-AR-female.wav…).
    VOICE_VOICES: path.join(deps.home, "voices"),
    // Where the engine keeps how long its last load took, to tell the next call how long it will wait.
    VOICE_STATE: path.join(deps.home, "voice"),
    ...extra,
  });

  function logTo(child: ChildProcess, withStdout = false): () => string {
    fs.mkdirSync(path.join(deps.home, "logs"), { recursive: true });
    const out = fs.createWriteStream(path.join(deps.home, "logs", "voice.log"), { flags: "a" });
    let stderr = "";
    // What the engine says of itself (its timings) goes to the log too; the prefetch's stdout is its progress.
    if (withStdout) child.stdout?.on("data", (d) => out.write(d));
    child.stderr?.on("data", (d) => {
      out.write(d);
      stderr = (stderr + String(d)).slice(-2000);
    });
    child.on("close", () => out.end());
    return () => stderr;
  }

  /** Written once a download of this tier's models finished: they are on disk, unless the models changed since. */
  const marker = (tier = machine().tier, part: VoicePart = "all") =>
    path.join(deps.home, "voice", part === "all" ? `installed-${tier}.json` : `installed-${tier}-${part}.json`);
  const done = (file: string) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")).rev === MODELS_REV;
    } catch {
      return false;
    }
  };
  /** Every model on disk; with `ears`, at least what hears (all of it counts too). */
  const installed = (part: VoicePart = "all") => {
    if (deps.services) return true;
    const tier = machine().tier;
    if (tier === "none") return false;
    return done(marker(tier)) || (part === "ears" && done(marker(tier, "ears")));
  };

  const stop = () => {
    current?.child.kill();
    current = undefined;
  };
  const idle = setInterval(() => {
    if (current && current.calls === 0 && Date.now() - current.used > (deps.idleMs ?? IDLE_MS)) {
      deps.log.info({}, "voice engine idle, stopped");
      stop();
    }
  }, 30_000);
  idle.unref();

  /** One engine at a time: requests that come while it starts share that start. */
  let starting: Promise<Running> | undefined;
  function start(): Promise<Running> {
    starting ??= spawnEngine().finally(() => {
      starting = undefined;
    });
    return starting;
  }

  async function spawnEngine(): Promise<Running> {
    const bin = await getUv();
    const port = await freePort();
    const secret = crypto.randomBytes(24).toString("base64url");
    const script = deps.services ? path.join(import.meta.dirname, "../voice/remote.py") : ENGINE;
    const child = run(bin, ["run", "--script", script, "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: env({ VOICE_SECRET: secret }),
    });
    const tail = logTo(child, true);
    const url = `http://127.0.0.1:${port}`;
    let spawnError: Error | undefined;
    child.on("error", (err) => {
      spawnError = err;
    });
    const ready = (async () => {
      const until = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < until) {
        if (spawnError) throw new Error(`the voice engine could not start: ${spawnError.message}`);
        if (child.exitCode !== null)
          throw new Error(`the voice engine stopped: ${tail().trim().split("\n").at(-1) ?? ""}`);
        try {
          const res = await fetch(`${url}/health`, {
            headers: { "x-voice-secret": secret },
            signal: AbortSignal.timeout(1000),
          });
          if (res.ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 300));
      }
      child.kill();
      throw new Error("the voice engine did not start in time");
    })();
    const r: Running = { child, url, secret, ready, used: Date.now(), calls: 0 };
    ready.then(
      () => {
        r.up = true;
      },
      () => {},
    );
    current = r;
    child.on("exit", (code) => {
      if (code) deps.log.warn({ code, stderr: tail().slice(-500) }, "voice engine stopped");
      if (current?.child === child) current = undefined;
    });
    return r;
  }

  /** The running engine, started (and waited for) when it is not up. */
  async function up(): Promise<Running> {
    const r = current ?? (await start());
    await r.ready.catch((err) => {
      if (current === r) stop();
      throw err;
    });
    r.used = Date.now();
    return r;
  }

  async function post(
    p: string,
    body: string | Uint8Array<ArrayBuffer>,
    type: string,
    signal: AbortSignal,
  ): Promise<Response> {
    const r = await up();
    r.calls++;
    try {
      const res = await fetch(`${r.url}${p}`, {
        method: "POST",
        headers: { "x-voice-secret": r.secret, "content-type": type },
        body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(SPEAK_TIMEOUT_MS)]),
      });
      if (!res.ok) throw new Error(`the voice engine answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res;
    } finally {
      r.calls = Math.max(0, r.calls - 1);
      r.used = Date.now();
    }
  }

  return {
    machine,
    canFull: () => machine().tier !== "none" && (deps.memoryGb ?? Math.round(os.totalmem() / 2 ** 30)) >= FULL_GB,
    /** The models changed: the engine starts again with them, now or once the call going on ends. */
    restart(): void {
      const r = current;
      if (!r) return;
      if (r.calls === 0) stop();
      else r.stale = true;
    },
    /** This machine's models are on disk. */
    installed,
    /** What this Mac's voice is made of and where its models are kept; none where it cannot run. */
    models() {
      const tier = machine().tier;
      if (tier === "none") return undefined;
      // Hugging Face's own cache, as the engine finds it: shared with other apps that use the same models.
      const env = process.env;
      const folder =
        env.HF_HUB_CACHE || path.join(env.HF_HOME || path.join(os.homedir(), ".cache", "huggingface"), "hub");
      const home = os.homedir();
      return {
        ...MODEL_NAMES[tier],
        folder: isInside(home, folder) ? path.join("~", path.relative(home, folder)) : folder,
      };
    },
    install: (): Install | undefined => (install ? { ...install } : undefined),
    running: () => Boolean(current),
    /** Whether a call would start at once (the engine is up) or first load it. */
    loading: () => !current?.up,
    /** About how many seconds a call waits for the engine to start and load, from its recent loads; unknown before one. */
    expectedWait(): number | undefined {
      let loads: unknown;
      try {
        loads = JSON.parse(fs.readFileSync(path.join(deps.home, "voice", `load-${machine().tier}.json`), "utf8"));
      } catch {
        return undefined;
      }
      if (!loads || typeof loads !== "object") return undefined;
      let total = 0;
      for (const times of Object.values(loads)) {
        const xs = Array.isArray(times)
          ? times.filter((x): x is number => typeof x === "number").sort((a, b) => a - b)
          : [];
        total += xs[Math.floor(xs.length / 2)] ?? 0;
      }
      return total > 0 ? Math.round(total) : undefined;
    },

    /** Downloads this machine's models (and the engine's packages), reporting progress; one at a time. */
    startInstall(part: VoicePart = "all"): void {
      if (machine().missing) throw new Error("APX's voice cannot run on this computer");
      if (install?.state === "downloading") return;
      // The tier this download is for: the owner may pick another meanwhile, which is then downloaded after it.
      const tier = machine().tier;
      install = { state: "downloading", received: 0, total: 0, part };
      // uv first, where this Mac has none: it is what downloads and runs the voice.
      getUv().then(
        (bin) => prefetch(bin, tier),
        (err) => {
          install = {
            state: "failed",
            received: 0,
            total: 0,
            error: err instanceof Error ? err.message : String(err),
            part,
          };
          deps.log.warn({ err: install.error }, "voice install failed");
        },
      );
      const prefetch = (bin: string, tier: VoiceMachine["tier"]) => {
        const child = run(bin, ["run", "--script", ENGINE, "--prefetch", "--part", part], {
          stdio: ["ignore", "pipe", "pipe"],
          env: env({}, tier),
        });
        const tail = logTo(child);
        let buf = "";
        child.stdout?.on("data", (d) => {
          buf += String(d);
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            try {
              const p = JSON.parse(line) as { received?: number; total?: number };
              if (install && typeof p.received === "number" && typeof p.total === "number")
                install = { ...install, received: p.received, total: p.total };
            } catch {}
          }
        });
        const failed = (why: string) => {
          install = { state: "failed", received: install?.received ?? 0, total: install?.total ?? 0, error: why, part };
          deps.log.warn({ err: why }, "voice install failed");
        };
        child.on("error", (err) => failed(err.message));
        child.on("exit", (code) => {
          if (code === 0) {
            install = undefined;
            fs.mkdirSync(path.dirname(marker(tier, part)), { recursive: true });
            fs.writeFileSync(marker(tier, part), JSON.stringify({ at: new Date().toISOString(), rev: MODELS_REV }));
            deps.log.info({ tier, part }, "voice installed");
            if (!installed(part) && !machine().missing) this.startInstall(part);
          } else failed(tail().trim().split("\n").at(-1) || `exit ${code}`);
        });
      };
    },

    /** Resolves once the models are on disk, downloading them when nobody has yet; a failed download throws. */
    async whenInstalled(signal: AbortSignal): Promise<void> {
      while (!installed()) {
        signal.throwIfAborted();
        if (install?.state === "failed") throw new Error(install.error ?? "the voice could not be downloaded");
        if (!install) this.startInstall();
        await new Promise((r) => setTimeout(r, 1000));
      }
    },

    /** Starts the engine (if it is not up) and has it load what a call uses, without waiting for it. */
    prepare(): void {
      void (async () => {
        const r = await up();
        await fetch(`${r.url}/prepare`, { method: "POST", headers: { "x-voice-secret": r.secret } });
      })().catch((err) => deps.log.warn({ err: err instanceof Error ? err.message : String(err) }, "voice prepare"));
    },

    /** One line in one of APX's voices ("es-AR-female"), as WAV. */
    async speak(text: string, voice: string, signal: AbortSignal) {
      const res = await post("/speech", JSON.stringify({ text, voice }), "application/json", signal);
      return { bytes: Buffer.from(await res.arrayBuffer()), mime: "audio/wav" };
    },

    /** What a recording (16 kHz mono PCM16) says; `draft`: quickly, with the small model, for words shown live. */
    async transcribe(pcm: Buffer, lang: string | undefined, signal: AbortSignal, draft = false): Promise<string> {
      const q = new URLSearchParams({ ...(lang ? { lang: lang.slice(0, 2) } : {}), ...(draft ? { draft: "1" } : {}) });
      const res = await post(`/transcribe?${q}`, new Uint8Array(pcm), "application/octet-stream", signal);
      return ((await res.json()) as { text?: string }).text?.trim() ?? "";
    },

    /** A socket to the engine for one call, starting the engine first when it is not up. */
    async open(q: CallSetup, onMessage?: (data: WebSocket.RawData, binary: boolean) => void): Promise<WebSocket> {
      const r = await up();
      const ws = new WebSocket(`${r.url.replace("http", "ws")}/call?${new URLSearchParams(q)}`, {
        maxPayload: 8 * 1024 * 1024,
        headers: { "x-voice-secret": r.secret },
      });
      // Before it opens: the first frame can arrive with the handshake itself.
      if (onMessage) ws.on("message", onMessage);
      r.calls++;
      ws.on("close", () => {
        r.calls = Math.max(0, r.calls - 1);
        r.used = Date.now();
        if (r.stale && r.calls === 0 && current === r) stop();
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      return ws;
    },

    close(): void {
      clearInterval(idle);
      stop();
    },
  };
}

export type VoiceEngine = ReturnType<typeof createVoiceEngine>;
