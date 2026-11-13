// APX's own voice (voice/engine.py), run by APX itself: it speaks the agents' voice notes, transcribes recordings and
// carries calls. Started when one of those needs it, stopped after a while unused so its models leave memory, listening
// on loopback only behind a secret. It needs uv, which brings its Python and packages, and Apple silicon (its models
// run on MLX). See DECISIONS.md#d-226
import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { VoiceMissing, VoiceQuality, VoiceTier } from "@apx/protocol";
import WebSocket from "ws";
import type { Log } from "../log.ts";
import { findProgram } from "../programs.ts";

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
const FULL_GB = 16;
const AUTO_FULL_GB = 32;

export type VoiceMachine = { tier: VoiceTier; memory_gb: number; missing?: VoiceMissing | undefined };

export type Install = { state: "downloading" | "failed"; received: number; total: number; error?: string | undefined };

/** What one call tells the engine: the voice, the accent, who talks and who is called. */
export type CallSetup = {
  voice: "female" | "male";
  locale: "es-AR" | "es" | "en-US";
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
  used: number;
  calls: number;
  /** Started with models the owner has since changed: stopped once no call uses it. */
  stale?: boolean;
};

export function createVoiceEngine(deps: {
  log: Log;
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
}) {
  let current: Running | undefined;
  let install: Install | undefined;
  const uv = () => (deps.uv ?? (() => findProgram("uv")))();
  const run = deps.spawn ?? spawn;

  function machine(): VoiceMachine {
    const memory_gb = deps.memoryGb ?? Math.round(os.totalmem() / 2 ** 30);
    if ((deps.platform ?? process.platform) !== "darwin" || (deps.arch ?? process.arch) !== "arm64")
      return { tier: "none", memory_gb, missing: "platform" };
    if (memory_gb < MIN_GB) return { tier: "none", memory_gb, missing: "memory" };
    const q = deps.quality?.() ?? "auto";
    const full = q === "full" ? memory_gb >= FULL_GB : q === "auto" && memory_gb >= AUTO_FULL_GB;
    return { tier: full ? "full" : "light", memory_gb, ...(uv() ? {} : { missing: "uv" as const }) };
  }

  const env = (extra: Record<string, string>) => ({
    ...process.env,
    VOICE_TIER: machine().tier,
    VOICE_PARENT_PID: String(process.pid),
    VOICE_OWNER: deps.owner?.() ?? "",
    // The owner's own recordings, used before APX's voices of the same name (es-AR-female.wav…).
    VOICE_VOICES: path.join(deps.home, "voices"),
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

  /** Written once a download of this tier's models finished: they are on disk. */
  const marker = () => path.join(deps.home, "voice", `installed-${machine().tier}.json`);
  const installed = () => machine().tier !== "none" && fs.existsSync(marker());

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

  async function start(): Promise<Running> {
    const bin = uv();
    if (!bin) throw new Error("uv is not installed (brew install uv)");
    const port = await freePort();
    const secret = crypto.randomBytes(24).toString("base64url");
    const child = run(bin, ["run", "--script", ENGINE, "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: env({ VOICE_SECRET: secret }),
    });
    const tail = logTo(child, true);
    const url = `http://127.0.0.1:${port}`;
    const ready = (async () => {
      const until = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < until) {
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
    install: (): Install | undefined => (install ? { ...install } : undefined),
    running: () => Boolean(current),
    /** Whether a call would start at once (the engine is up) or first load it. */
    loading: () => !current,

    /** Downloads this machine's models (and the engine's packages), reporting progress; one at a time. */
    startInstall(): void {
      const bin = uv();
      if (machine().missing || !bin) throw new Error("APX's voice cannot run on this computer");
      if (install?.state === "downloading") return;
      install = { state: "downloading", received: 0, total: 0 };
      const child = run(bin, ["run", "--script", ENGINE, "--prefetch"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: env({}),
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
        install = { state: "failed", received: install?.received ?? 0, total: install?.total ?? 0, error: why };
        deps.log.warn({ err: why }, "voice install failed");
      };
      child.on("error", (err) => failed(err.message));
      child.on("exit", (code) => {
        if (code === 0) {
          install = undefined;
          fs.mkdirSync(path.dirname(marker()), { recursive: true });
          fs.writeFileSync(marker(), JSON.stringify({ at: new Date().toISOString() }));
          deps.log.info({ tier: machine().tier }, "voice installed");
        } else failed(tail().trim().split("\n").at(-1) || `exit ${code}`);
      });
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

    /** What a recording (16 kHz mono PCM16) says. */
    async transcribe(pcm: Buffer, lang: string | undefined, signal: AbortSignal): Promise<string> {
      const q = lang ? `?lang=${encodeURIComponent(lang.slice(0, 2))}` : "";
      const res = await post(`/transcribe${q}`, new Uint8Array(pcm), "application/octet-stream", signal);
      return ((await res.json()) as { text?: string }).text?.trim() ?? "";
    },

    /** A socket to the engine for one call, starting the engine first when it is not up. */
    async open(q: CallSetup): Promise<WebSocket> {
      const r = await up();
      const ws = new WebSocket(`${r.url.replace("http", "ws")}/call?${new URLSearchParams(q)}`, {
        headers: { "x-voice-secret": r.secret },
      });
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
