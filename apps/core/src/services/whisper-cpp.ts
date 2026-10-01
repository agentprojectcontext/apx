// whisper.cpp's `whisper-server`, run by APX itself: started on the first voice note, stopped after a while unused,
// listening on loopback only. The owner points it at a ggml model file; ffmpeg converts the audio (--convert).
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";

const START_TIMEOUT_MS = 60_000;
const IDLE_MS = 10 * 60_000;

/** A model path as the owner wrote it ("~/models/ggml-small.bin" works). */
export const modelPath = (p: string) => path.resolve(p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

/** The first `whisper-server` on PATH, if any. */
function binary(command: string): string | undefined {
  if (path.isAbsolute(command)) return fs.existsSync(command) ? command : undefined;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(dir, command);
    if (dir && fs.existsSync(p)) return p;
  }
  return undefined;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });

type Running = { model: string; url: string; child: ChildProcess; used: number; ready: Promise<string> };

export function createWhisperCpp(deps: { log: Log; command?: string; idleMs?: number }) {
  const command = deps.command ?? "whisper-server";
  let current: Running | undefined;

  const stop = () => {
    current?.child.kill();
    current = undefined;
  };
  const idle = setInterval(() => {
    if (current && Date.now() - current.used > (deps.idleMs ?? IDLE_MS)) {
      deps.log.info({ model: current.model }, "whisper.cpp idle, stopped");
      stop();
    }
  }, 30_000);
  idle.unref();

  async function start(model: string): Promise<string> {
    const bin = binary(command);
    if (!bin) throw new Error(`${command} is not installed (brew install whisper-cpp)`);
    if (!fs.existsSync(model)) throw new Error(`no model file at ${model}`);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const child = spawn(bin, ["-m", model, "--host", "127.0.0.1", "--port", String(port), "--convert"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr = (stderr + String(d)).slice(-1000);
    });
    const ready = (async () => {
      const until = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < until) {
        if (child.exitCode !== null)
          throw new Error(`whisper-server stopped: ${stderr.trim().split("\n").at(-1) ?? ""}`);
        try {
          if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return url;
        } catch {}
        await new Promise((r) => setTimeout(r, 300));
      }
      child.kill();
      throw new Error("whisper-server did not start in time");
    })();
    current = { model, url, child, used: Date.now(), ready };
    child.on("exit", () => {
      if (current?.child === child) current = undefined;
    });
    return ready;
  }

  return {
    /** Whether it could run: the program is installed and the model file is there (nothing is started). */
    available: (model: string | undefined) => Boolean(model && binary(command) && fs.existsSync(modelPath(model))),
    async transcribe(
      a: { bytes: Buffer; mime: string; model: string; language?: string | undefined },
      signal: AbortSignal,
    ): Promise<string> {
      const model = modelPath(a.model);
      if (current && current.model !== model) stop();
      const url = await (current?.ready ?? start(model)).catch((err) => {
        stop();
        throw new Error(errorMessage(err, 300));
      });
      if (current) current.used = Date.now();
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(a.bytes)], { type: a.mime }), "voice");
      form.set("response_format", "json");
      form.set("temperature", "0");
      form.set("language", a.language || "auto");
      const res = await fetch(`${url}/inference`, { method: "POST", body: form, signal });
      const j = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
      return (j.text ?? "").trim();
    },
    close(): void {
      clearInterval(idle);
      stop();
    },
  };
}

export type WhisperCpp = ReturnType<typeof createWhisperCpp>;
