// shell: an agent runs a command on the owner's machine, in its project's folder. Commands that only read run like
// any tool; anything else waits for the owner (unless the agent's autonomy is total); destructive ones always do.
// The environment never carries APX's secrets (harness/env.ts).
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { untrusted } from "./result.ts";
import { type Confirm, defineTool, type Tool } from "./types.ts";

/** Programs that only read (with no output redirection anywhere in the command). */
const READ_ONLY = new Set([
  "sleep",
  "true",
  "ls",
  "pwd",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "echo",
  "which",
  "date",
  "whoami",
  "du",
  "df",
  "stat",
  "file",
  "tree",
  "uname",
  "sort",
  "uniq",
  "cut",
  "jq",
]);
const READ_ONLY_GIT = /^git\s+(status|log|diff|show|branch|remote\s+-v|rev-parse|ls-files|blame)\b/;
const DESTRUCTIVE =
  /\b(sudo|su|mkfs|dd|shutdown|reboot|halt|diskutil|launchctl|crontab)\b|\brm\s+(-\w*[rf]\w*\s+)*-\w*[rf]|\bgit\s+(push|reset\s+--hard|clean\s+-\w*f)|\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b|\bchmod\s+-R|\bchown\s+-R|:\(\)\s*\{|>\s*\/dev\/(sd|disk)/;

/** How much the owner must be asked for this command. */
export function commandRisk(command: string): Confirm {
  const c = command.trim();
  if (DESTRUCTIVE.test(c)) return "always";
  if (/[>`$]|\$\(/.test(c)) return "ask";
  const segments = c
    .split(/&&|\|\||[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const reads = segments.every((s) => {
    if (READ_ONLY_GIT.test(s)) return true;
    const word = s.split(/\s+/)[0] ?? "";
    if (word === "find") return !/-(delete|exec|ok)\b/.test(s);
    return READ_ONLY.has(word);
  });
  return reads ? "never" : "ask";
}

export function shellTools(store: Store, home: string): Tool[] {
  /** The project's folder when the thread belongs to one that is on disk, else APX's own work folder. */
  const baseDir = (projectId: string | undefined) => {
    const p = projectId ? store.projects.get(projectId) : undefined;
    return p?.path && p.present ? p.path : path.join(home, "work");
  };
  return [
    defineTool({
      name: "shell",
      description:
        "Run a shell command (sh) in the project's folder. Foreground: waits up to timeout_s and returns the output. background=true: returns a job id at once, the owner sees it running, and you get the end of its output in a new turn when it ends (use it for servers, long builds, watchers). Commands that change things may wait for the owner's OK.",
      args: z.object({
        command: z.string().min(1).max(4000),
        background: z.boolean().optional(),
        timeout_s: z.number().int().min(1).max(600).optional().describe("foreground only; default 120"),
        cwd: z.string().max(500).optional().describe("folder inside the project, relative"),
      }),
      effect: "external",
      confirm: (a) => commandRisk(a.command),
      // Covers the longest foreground wait plus the time to stop the process.
      deadlineMs: 615_000,
      title: (a) => `Ran ${String(a.command ?? "").slice(0, 60)}`,
      async run(a, ctx) {
        const base = baseDir(ctx.thread.project_id);
        const cwd = path.resolve(base, a.cwd ?? ".");
        if (cwd !== base && !cwd.startsWith(`${base}${path.sep}`))
          return `refused: ${a.cwd} is outside the project folder`;
        if (cwd === base) fs.mkdirSync(base, { recursive: true });
        else if (!fs.existsSync(cwd)) return `no folder ${a.cwd} in the project`;
        const r = await ctx.runCommand({
          command: a.command,
          cwd,
          background: a.background ?? false,
          timeoutMs: (a.timeout_s ?? 120) * 1000,
        });
        if (a.background)
          return `started job ${r.job.id} in the background (${cwd}). You will get the end of its output when it ends; shell_output reads it now.`;
        const exit =
          r.job.state === "canceled" ? `stopped after ${a.timeout_s ?? 120}s` : `exit ${r.job.exit_code ?? "?"}`;
        return `${exit} · ${cwd}\n${untrusted("command_output", { job: r.job.id }, r.output || "(no output)")}`;
      },
    }),
    defineTool({
      name: "shell_output",
      description: "Read the output of a terminal job (the end of it, or from offset).",
      args: z.object({ job: z.string().min(1), offset: z.number().int().min(0).optional() }),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Read a job's output",
      async run(a, ctx) {
        const r = await ctx.call("jobs.get", { job: a.job, ...(a.offset === undefined ? {} : { offset: a.offset }) });
        const head = `${r.job.state}${r.job.exit_code === undefined ? "" : ` (exit ${r.job.exit_code})`} · ${r.size} bytes · showing from ${r.offset}`;
        return `${head}\n${untrusted("command_output", { job: a.job }, r.output)}`;
      },
    }),
    defineTool({
      name: "shell_kill",
      description: "Stop a terminal job you started.",
      args: z.object({ job: z.string().min(1) }),
      effect: "local",
      deadlineMs: 10_000,
      title: () => "Stopped a job",
      async run(a, ctx) {
        const r = await ctx.call("jobs.cancel", { job: a.job });
        return r.canceled ? `job ${a.job} stopped` : `job ${a.job} was not running`;
      },
    }),
  ];
}
