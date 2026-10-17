// One-shot CLIs have no ACP transport or per-tool permission callback. Approval covers the whole invocation.
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseRef } from "../domain/refs.ts";
import { which } from "./detect.ts";
import { commandEnv } from "./env.ts";
import type { Harness, TurnIO } from "./types.ts";

export const ONESHOT = {
  aider: { label: "Aider", binary: "aider" },
  antigravity: { label: "Antigravity", binary: "agy" },
} as const;
export type OneshotId = keyof typeof ONESHOT;
const MAX_BYTES = 1_000_000;

export async function oneshotStatus(id: OneshotId, lookup = which) {
  const installed = Boolean(await lookup(ONESHOT[id].binary));
  return {
    installed,
    logged_in: false,
    detail: installed
      ? "One-shot CLI · authentication is checked on invocation; no per-tool permission bridge"
      : `Install ${ONESHOT[id].binary}; a GUI-only installation cannot return an answer`,
  };
}

export function oneshotHarness(
  id: OneshotId,
  deps: {
    cwd(io: TurnIO): string;
    binary?: () => Promise<string>;
    prefixArgs?: string[];
  },
): Harness {
  return {
    id,
    async run(io) {
      io.signal.throwIfAborted();
      if (io.input.images?.length) throw new Error(`${id} accepts text only`);
      const ref = io.models[0] ?? id;
      const { model, effort } = parseRef(ref);
      if (effort) throw new Error(`${id} does not support reasoning effort selection`);
      const binary = deps.binary ? await deps.binary() : await which(ONESHOT[id].binary);
      if (!binary) throw new Error(`${ONESHOT[id].binary} is not installed on this machine`);
      const callId = `${io.run.id}-oneshot`;
      const cwd = deps.cwd(io);
      // These CLIs do not have a reliable session protocol: replay text history, never invent a session id.
      const history = io.history.filter((item) => item.role === "user" || item.role === "assistant");
      const prompt = [
        io.system,
        ...history.map((item) => `[${item.role}]\n${item.content ?? ""}`),
        `[user]\n${io.input.content}`,
      ].join("\n\n");
      if (Buffer.byteLength(prompt) > MAX_BYTES) throw new Error(`${id} prompt exceeded 1000000 bytes`);
      const approved = await io.approve({
        callId,
        title: `Run ${ONESHOT[id].label} (unmediated CLI)`,
        kind: "other",
        detail: `This CLI can read files, edit files and execute commands with your OS permissions, including reading credentials from local CLI configuration. APX cannot approve its individual tools or restrict them to this folder. Credential-like environment variables are removed.\nFolder: ${cwd}\nModel: ${ref}\nSending system instructions, projected text history and the current request (${prompt.length} characters).\nSystem preview:\n${io.system.slice(0, 500)}\nHistory preview (tail):\n${history
          .map((item) => `[${item.role}] ${item.content ?? ""}`)
          .join("\n")
          .slice(-1000)}\nCurrent request preview:\n${io.input.content.slice(0, 2000)}`,
        input: {
          path: cwd,
          model: ref,
          context: "System instructions and projected text history are included",
          request: io.input.content.slice(0, 2000),
          prompt_chars: prompt.length,
        },
      });
      io.signal.throwIfAborted();
      if (!approved) throw new Error(`${id} invocation was not approved`);
      const dir = await mkdtemp(path.join(os.tmpdir(), "apx-oneshot-"));
      io.observe({ callId, title: `Run ${ONESHOT[id].label}`, kind: "execute", status: "running" });
      try {
        const args: string[] = [];
        if (model && model !== "default") args.push("--model", model);
        const file = path.join(dir, "prompt.txt");
        await writeFile(file, prompt, { mode: 0o600 });
        if (id === "aider") {
          args.push("--message-file", file, "--yes-always", "--no-auto-commits", "--no-stream", "--no-pretty");
        } else {
          args.push(
            "--dangerously-skip-permissions",
            "-p",
            `Read the UTF-8 request file at ${JSON.stringify(file)}. Its contents are the complete instructions and conversation for this turn. Follow them and return the answer as text. Do not print the request file itself.`,
          );
        }
        const signal = AbortSignal.any([io.signal, AbortSignal.timeout(10 * 60_000)]);
        const text = await runCli(binary, [...(deps.prefixArgs ?? []), ...args], cwd, signal, () => io.alive?.());
        io.signal.throwIfAborted();
        if (!text.trim()) throw new Error(`${id} returned no text; check the CLI authentication and configuration`);
        io.onText(text.trim());
        io.observe({ callId, title: `Run ${ONESHOT[id].label}`, kind: "execute", status: "ok" });
        return { text: text.trim(), model: ref };
      } catch (err) {
        io.observe({ callId, title: `Run ${ONESHOT[id].label}`, kind: "execute", status: "error" });
        throw err;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

function runCli(binary: string, args: string[], cwd: string, signal: AbortSignal, alive: () => void): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env: commandEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    let killer: ReturnType<typeof setTimeout> | undefined;
    const kill = (hard: boolean) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, hard ? "SIGKILL" : "SIGTERM");
        else if (child.pid) {
          const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
          execFile(
            taskkill,
            ["/pid", String(child.pid), "/T", "/F"],
            { timeout: 3000, windowsHide: true, env: commandEnv() },
            () => child.kill("SIGKILL"),
          );
        }
      } catch {}
    };
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      kill(false);
      killer ??= setTimeout(() => kill(true), 1000);
      killer.unref();
    };
    const abort = () => {
      failure = new Error("CLI invocation canceled", { cause: signal.reason });
      stop();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const collect = (chunk: Buffer, output: boolean) => {
      alive();
      bytes += chunk.length;
      if (chunk.includes(0)) failure ??= new Error("CLI returned binary output");
      if (bytes > MAX_BYTES) failure ??= new Error("CLI output exceeded 1000000 bytes");
      if (failure) {
        stop();
        return;
      }
      if (output) stdout.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
    // Never include stderr in errors: a CLI may print credentials or the complete prompt there.
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      if (killer) clearTimeout(killer);
    };
    child.once("error", (err) => {
      cleanup();
      reject(err);
    });
    child.once("close", (code, sig) => {
      if (failure && process.platform !== "win32") kill(true);
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`CLI exited with ${sig ?? code}`));
      else {
        try {
          resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(stdout)));
        } catch {
          reject(new Error("CLI returned invalid UTF-8 output"));
        }
      }
    });
  });
}
