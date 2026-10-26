import { spawn } from "node:child_process";
import type { EngineStatus, EngineUsageReport, EngineUsageWindow } from "@apx/protocol";
import { z } from "zod";
import { readClaudeUsage } from "./claude-usage.ts";
import { which } from "./detect.ts";
import { commandEnv } from "./env.ts";

const Window = z.object({
  usedPercent: z.number().min(0).max(100),
  windowDurationMins: z.number().int().positive().nullish(),
  resetsAt: z.number().int().nonnegative().max(253402300799).nullish(),
});
const RateLimits = z.object({
  rateLimits: z.object({ primary: Window.nullish(), secondary: Window.nullish() }),
});
type Deadline = (ms: number, callback: () => void) => () => void;
const after: Deadline = (ms, callback) => {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
};

/** Only the supported account read: no session, turn or authentication request is opened. */
export async function readCodexUsage(
  command: string,
  options: { env?: NodeJS.ProcessEnv; runTimers?: { after: Deadline }; timeoutMs?: number; maxBytes?: number } = {},
): Promise<EngineUsageWindow[] | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, ["app-server"], {
      env: options.env ?? commandEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let result: EngineUsageWindow[] | undefined;
    let stopped = false;
    let bytes = 0;
    let buffer = "";
    let phase: "initialize" | "read" = "initialize";
    const stop = () => {
      if (stopped) return;
      stopped = true;
      child.stdin.end();
      child.kill("SIGKILL");
    };
    const cancel = (options.runTimers?.after ?? after)(options.timeoutMs ?? 8_000, stop);
    const send = (frame: unknown) => child.stdin.write(`${JSON.stringify(frame)}\n`);
    child.on("error", stop);
    child.stdin.on("error", stop);
    child.on("close", () => {
      cancel();
      resolve(result);
    });
    const acceptBytes = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 256 * 1024)) stop();
      return !stopped;
    };
    child.stderr.on("data", (chunk: Buffer) => acceptBytes(chunk));
    child.stdout.on("data", (chunk: Buffer) => {
      if (!acceptBytes(chunk)) return;
      buffer += chunk.toString("utf8");
      while (!stopped && buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const frame = z
            .object({
              id: z.union([z.number(), z.string()]).optional(),
              result: z.unknown().optional(),
              error: z.unknown().optional(),
            })
            .parse(JSON.parse(line));
          if (frame.id !== (phase === "initialize" ? 1 : 2)) continue;
          if (frame.error !== undefined || frame.result === undefined) return stop();
          if (phase === "initialize") {
            phase = "read";
            send({ method: "initialized" });
            send({ id: 2, method: "account/rateLimits/read" });
          } else {
            const limits = RateLimits.parse(frame.result).rateLimits;
            const windows: EngineUsageWindow[] = [];
            for (const key of ["primary", "secondary"] as const) {
              const window = limits[key];
              if (!window) continue;
              windows.push({
                id: key,
                used_percent: window.usedPercent,
                ...(window.windowDurationMins != null ? { window_minutes: window.windowDurationMins } : {}),
                ...(window.resetsAt != null ? { resets_at: new Date(window.resetsAt * 1000).toISOString() } : {}),
              });
            }
            result = windows.length ? windows : undefined;
            stop();
          }
        } catch {
          stop();
        }
      }
    });
    child.on("spawn", () =>
      send({
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "apx", version: "2.0.0" } },
      }),
    );
  });
}

/** Availability only: quota checks must not wait for every engine's login or model discovery. */
export async function detectUsageEngines(
  lookup = which,
  additional: readonly { id: string; label: string; command: string }[] = [],
): Promise<EngineStatus[]> {
  const extra = additional.map(({ id, label, command }) => [id, label, command] as const);
  const ids = new Set(extra.map(([id]) => (id === "acp:opencode" ? "opencode" : id)));
  const base: (readonly [string, string, string])[] = [
    ["claude", "Claude", "claude"],
    ["codex", "Codex", "codex"],
    ["opencode", "OpenCode", "opencode"],
    ["antigravity", "Antigravity", "agy"],
  ];
  return Promise.all(
    [...base.filter(([id]) => !ids.has(id)), ...extra].map(async ([id, label, command]) => ({
      id,
      label,
      installed: Boolean(await lookup(command)),
      logged_in: false,
      default: false,
    })),
  );
}

export function createEngineUsage(deps: {
  status: () => Promise<EngineStatus[]>;
  binary?: () => Promise<string | undefined>;
  read?: typeof readCodexUsage;
  claudeBinary?: () => Promise<string | undefined>;
  readClaude?: typeof readClaudeUsage;
  now?: () => Date;
  enabled?: (id: string) => boolean;
}) {
  let pending: Promise<EngineUsageReport> | undefined;
  const report = async (): Promise<EngineUsageReport> => {
    const statuses = (await deps.status()).filter(
      (engine) => engine.id !== "native" && (deps.enabled?.(engine.id) ?? true),
    );
    const engines: EngineUsageReport["engines"] = await Promise.all(
      statuses.map(async (engine) => {
        if (!engine.installed) {
          return {
            id: engine.id,
            label: engine.label,
            cli_installed: false,
            available: false,
            source: "none",
            status: "unavailable",
            reason: "cli_not_found",
            windows: [],
          };
        } else if (engine.id !== "codex" && engine.id !== "claude") {
          return {
            id: engine.id,
            label: engine.label,
            cli_installed: true,
            available: false,
            source: "none",
            status: "unavailable",
            reason: "unsupported",
            windows: [],
          };
        } else {
          const claude = engine.id === "claude";
          const binary = await (claude
            ? (deps.claudeBinary ?? (() => which("claude")))
            : (deps.binary ?? (() => which("codex"))))();
          const read = claude ? (deps.readClaude ?? readClaudeUsage) : (deps.read ?? readCodexUsage);
          const windows = binary ? await read(binary) : undefined;
          return {
            id: engine.id,
            label: engine.label,
            cli_installed: true,
            available: Boolean(windows),
            source: claude ? "claude_cli" : "codex_app_server",
            status: windows ? "ok" : "unavailable",
            windows: windows ?? [],
            ...(windows ? {} : { reason: "not_available" as const }),
          };
        }
      }),
    );
    return { checked_at: (deps.now?.() ?? new Date()).toISOString(), engines };
  };
  return () => {
    pending ??= report().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
