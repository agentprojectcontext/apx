// The voice engine for calls (voice/engine.py), run by APX itself: started for a call, stopped after a while without
// one so its models leave the GPU, listening on loopback only behind a secret. It needs uv, which brings its Python
// and packages on the first start, and Apple silicon (its speech models run on MLX).
import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import type { Log } from "../log.ts";
import { findProgram } from "../programs.ts";

const START_TIMEOUT_MS = 10 * 60_000; // the first start downloads Python packages and models
const IDLE_MS = 10 * 60_000;
const ENGINE = path.join(import.meta.dirname, "../voice/engine.py");

export type VoiceConfig = {
  /** Where the voice model answers: an Ollama server (`/api/chat`) or an OpenAI-compatible one. */
  llmUrl: string;
  llmModel: string;
  llmKind: "ollama" | "openai";
  /** A secret reference for an OpenAI-compatible key, resolved only when the engine starts. */
  llmKey?: string | undefined;
  /** Folder with the cloned voices: <name>.wav and, if there is one, <name>.json with what it says (`refText`). */
  voices: string;
  female: string;
  male: string;
  /** Qwen3-TTS Base checkpoint: a folder or a Hugging Face id. */
  ttsModel: string;
};

/** A path as the owner wrote it ("~/voices" works). */
const expand = (p: string) => path.resolve(p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });

type Running = { child: ChildProcess; url: string; secret: string; ready: Promise<void>; used: number; calls: number };

export function createVoiceEngine(deps: {
  log: Log;
  config: VoiceConfig;
  /** APX's home: the engine keeps its downloaded models under <home>/voice. */
  home: string;
  resolveKey?: (ref: string) => Promise<string | undefined>;
  /** The owner's name: the engine makes its greetings ahead with it. */
  owner?: () => string;
  idleMs?: number;
  platform?: NodeJS.Platform;
  arch?: string;
  spawn?: typeof spawn;
}) {
  const cfg = deps.config;
  let current: Running | undefined;

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

  /** What a call still needs on this machine, or undefined when it can run. */
  function missing(): "platform" | "uv" | "voice" | undefined {
    if ((deps.platform ?? process.platform) !== "darwin" || (deps.arch ?? process.arch) !== "arm64") return "platform";
    if (!findProgram("uv")) return "uv";
    const voices = expand(cfg.voices);
    if (![cfg.female, cfg.male].some((v) => fs.existsSync(path.join(voices, `${v}.wav`)))) return "voice";
    return undefined;
  }

  async function start(): Promise<Running> {
    const uv = findProgram("uv");
    if (!uv) throw new Error("uv is not installed (brew install uv)");
    const port = await freePort();
    const secret = crypto.randomBytes(24).toString("base64url");
    const key = cfg.llmKey ? await deps.resolveKey?.(cfg.llmKey) : undefined;
    const child = (deps.spawn ?? spawn)(uv, ["run", "--script", ENGINE, "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        VOICE_SECRET: secret,
        VOICE_PARENT_PID: String(process.pid),
        VOICE_OWNER: deps.owner?.() ?? "",
        VOICE_LLM_URL: cfg.llmUrl,
        VOICE_LLM_MODEL: cfg.llmModel,
        VOICE_LLM_KIND: cfg.llmKind,
        ...(key ? { VOICE_LLM_KEY: key } : {}),
        VOICE_VOICES: expand(cfg.voices),
        VOICE_FEMALE: cfg.female,
        VOICE_MALE: cfg.male,
        VOICE_TTS_MODEL: cfg.ttsModel.startsWith("~/") ? expand(cfg.ttsModel) : cfg.ttsModel,
        VOICE_CACHE: path.join(deps.home, "voice"),
      },
    });
    // What it says goes to <home>/logs/voice.log; the end of it explains a start that failed.
    fs.mkdirSync(path.join(deps.home, "logs"), { recursive: true });
    const out = fs.createWriteStream(path.join(deps.home, "logs", "voice.log"), { flags: "a" });
    let stderr = "";
    child.stdout?.pipe(out, { end: false });
    child.stderr?.on("data", (d) => {
      out.write(d);
      stderr = (stderr + String(d)).slice(-2000);
    });
    child.on("close", () => out.end());
    const url = `http://127.0.0.1:${port}`;
    const ready = (async () => {
      const until = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < until) {
        if (child.exitCode !== null)
          throw new Error(`the voice engine stopped: ${stderr.trim().split("\n").at(-1) ?? ""}`);
        try {
          const res = await fetch(`${url}/health`, {
            headers: { "x-voice-secret": secret },
            signal: AbortSignal.timeout(1000),
          });
          if (res.ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
      child.kill();
      throw new Error("the voice engine did not start in time");
    })();
    const run: Running = { child, url, secret, ready, used: Date.now(), calls: 0 };
    current = run;
    child.on("exit", (code) => {
      if (code) deps.log.warn({ code, stderr: stderr.slice(-500) }, "voice engine stopped");
      if (current?.child === child) current = undefined;
    });
    return run;
  }

  return {
    status: () => ({ ready: missing() === undefined, running: Boolean(current), missing: missing() }),
    /** Whether a call would start at once (the engine is up) or first load it. */
    loading: () => !current,

    /** A socket to the engine for one call, starting the engine first when it is not up. */
    async open(q: { voice: string; lang: string; owner: string; agent: string }): Promise<WebSocket> {
      const run = current ?? (await start());
      await run.ready.catch((err) => {
        stop();
        throw err;
      });
      const params = new URLSearchParams(q);
      const ws = new WebSocket(`${run.url.replace("http", "ws")}/call?${params}`, {
        headers: { "x-voice-secret": run.secret },
      });
      run.calls++;
      ws.on("close", () => {
        run.calls = Math.max(0, run.calls - 1);
        run.used = Date.now();
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
