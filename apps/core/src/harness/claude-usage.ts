import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineUsageWindow } from "@apx/protocol";
import { z } from "zod";
import { stopTree } from "../processes.ts";
import { commandEnv } from "./env.ts";

type Deadline = (ms: number, callback: () => void) => () => void;
type Launch = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;
type Options = {
  launch?: Launch;
  env?: NodeJS.ProcessEnv;
  runTimers?: { after: Deadline };
  timeoutMs?: number;
  maxBytes?: number;
};
const after: Deadline = (ms, callback) => {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
};
const Report = z.object({
  rate_limits: z.object({
    limits: z.array(
      z.object({
        kind: z.string(),
        percent: z.number().min(0).max(100),
        resets_at: z.iso.datetime({ offset: true }).nullable(),
      }),
    ),
  }),
});

export function parseClaudeUsage(output: string): EngineUsageWindow[] | undefined {
  let report: z.infer<typeof Report> | undefined;
  let success = false;
  try {
    for (const line of output.split("\n").filter((line) => line.trim())) {
      const frame = JSON.parse(line);
      if (frame.type === "assistant" && frame.usage_report) report = Report.parse(frame.usage_report);
      if (frame.type === "result") {
        success = frame.subtype === "success" && frame.num_turns === 0 && frame.total_cost_usd === 0;
        const usage = frame.usage;
        if (
          !usage ||
          ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"].some(
            (key) => usage[key] !== 0,
          )
        )
          return undefined;
      }
    }
  } catch {
    return undefined;
  }
  if (!success || !report) return undefined;
  const windows: EngineUsageWindow[] = [];
  for (const [kind, id, minutes] of [
    ["session", "primary", 300],
    ["weekly_all", "secondary", 10080],
  ] as const) {
    const limits = report.rate_limits.limits.filter((limit) => limit.kind === kind);
    if (limits.length > 1) return undefined;
    const limit = limits[0];
    if (limit)
      windows.push({
        id,
        used_percent: limit.percent,
        window_minutes: minutes,
        ...(limit.resets_at ? { resets_at: new Date(limit.resets_at).toISOString() } : {}),
      });
  }
  return windows.length ? windows : undefined;
}

function capture(command: string, args: string[], cwd: string, options: Options): Promise<string | undefined> {
  return new Promise((resolve) => {
    const launch: Launch =
      options.launch ??
      ((command, args, cwd, env) =>
        spawn(command, args, {
          cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          detached: process.platform !== "win32",
        }));
    const child = launch(command, args, cwd, options.env ?? commandEnv());
    let output = "";
    let bytes = 0;
    let stopped = false;
    let stopping: Promise<void> | undefined;
    const cleanup = () =>
      (stopping ??= (child.pid ? stopTree(child.pid, { graceMs: 0 }) : Promise.resolve()).finally(() => {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      }));
    const stop = () => {
      stopped = true;
      void cleanup();
    };
    const cancel = (options.runTimers?.after ?? after)(options.timeoutMs ?? 8_000, stop);
    child.on("error", stop);
    child.stdin.on("error", stop);
    child.stdin.end();
    child.on("close", async (code) => {
      cancel();
      await cleanup();
      resolve(!stopped && code === 0 ? output : undefined);
    });
    const accept = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 256 * 1024)) stop();
    };
    child.stderr.on("data", accept);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      accept(Buffer.from(chunk));
      if (!stopped) output += chunk;
    });
  });
}

/** The CLI owns authentication; /usage is local command dispatch, never a model prompt. */
export async function readClaudeUsage(
  command: string,
  options: Options = {},
): Promise<EngineUsageWindow[] | undefined> {
  const cwd = await mkdtemp(join(tmpdir(), "apx-usage-"));
  try {
    const version = await capture(command, ["--version"], cwd, {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? 3_000, 3_000),
    });
    const parts = version?.match(/^(\d+)\.(\d+)\.(\d+)\s+\(Claude Code\)/);
    if (!parts) return undefined;
    const [major, minor, patch] = parts.slice(1).map(Number);
    if (major !== 2 || minor === undefined || patch === undefined || minor < 1 || (minor === 1 && patch < 273))
      return undefined;
    const output = await capture(
      command,
      [
        "-p",
        "/usage",
        "--safe-mode",
        "--no-session-persistence",
        "--max-turns",
        "0",
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        "",
        "--strict-mcp-config",
        "--settings",
        '{"disableAllHooks":true,"remoteControlAtStartup":false}',
      ],
      cwd,
      options,
    );
    return output ? parseClaudeUsage(output) : undefined;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
