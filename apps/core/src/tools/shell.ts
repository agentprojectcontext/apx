// shell: an agent runs a command on the owner's machine, in its project's folder. Commands that only read run like
// any tool; anything else waits for the owner (unless the agent's autonomy is total); destructive ones always do.
// Commands get an environment without secret-looking variables (harness/env.ts) and cannot name APX's home.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { insideReal } from "../paths.ts";
import { untrusted } from "./result.ts";
import { type Confirm, defineTool, type Tool } from "./types.ts";

/**
 * Programs that only read when given plain arguments. Anything with options that write (sort -o, tree -o, rg --pre,
 * file -C, git --output) is left out or checked below.
 */
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
  "echo",
  "which",
  "date",
  "whoami",
  "du",
  "df",
  "stat",
  "uname",
  "cut",
]);
const READ_ONLY_GIT = new Set(["status", "log", "diff", "show", "rev-parse", "ls-files", "blame"]);
/** Shell syntax that can hide a second command, a redirection, an expansion or a subshell. */
const SHELL_SYNTAX = /[\n\r&;|<>`$(){}\\[\]!#~]/;
const DESTRUCTIVE =
  /\b(sudo|su|doas|mkfs|dd|shutdown|reboot|halt|diskutil|launchctl|crontab|shred|srm)\b|\brm\b[^|;&]*\s(-\w*[rf]|--recursive|--force)|\bgit\b[^|;&]*\s(push|reset\s+--hard|clean\b|filter-branch|update-ref\s+-d)|\b(curl|wget|fetch)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\bchmod\b[^|;&]*\s-\w*R|\bchown\b[^|;&]*\s-\w*R|:\(\)\s*\{|\/dev\/(sd|disk|nvme)/;

/** The command as the shell will mostly see it: quotes and escapes dropped, paths to programs reduced to names. */
const normalize = (c: string) =>
  c
    .replace(/\\\n/g, " ")
    .replace(/["'\\]/g, "")
    .replace(/(^|[\s;&|(])\/(?:[\w.-]+\/)*([\w.-]+)/g, "$1$2");

/** A plain, project-local argument: not a path that leaves the folder, not the home, no `..`. */
const localArg = (a: string) => !a.startsWith("/") && !a.includes("..") && !/^(~|\.apx)/.test(a);

/**
 * How much the owner must be asked for this command. Only simple commands of known reading programs, with plain
 * arguments inside the project, run without asking; anything the classifier cannot be sure of asks.
 */
export function commandRisk(command: string, apxPort?: number): Confirm {
  const c = command.trim();
  if (DESTRUCTIVE.test(c) || DESTRUCTIVE.test(normalize(c))) return "always";
  // A command that talks to APX's own API could act as the owner (answer its own confirmation): always asked.
  if (apxPort && new RegExp(`(127\\.0\\.0\\.1|localhost|\\[::1\\]|0\\.0\\.0\\.0):${apxPort}\\b`).test(c))
    return "always";
  // Pipes and && between simple commands are fine; any other shell syntax is not judged, it is asked.
  const segments = c.split(/&&|\|\||\|/).map((x) => x.trim());
  const simple = (seg: string): boolean => {
    if (!seg || SHELL_SYNTAX.test(seg) || /["']/.test(seg)) return false;
    const [word = "", ...args] = seg.split(/\s+/);
    if (/=/.test(word)) return false;
    if (!args.every(localArg)) return false;
    if (word === "git") return READ_ONLY_GIT.has(args[0] ?? "") && !args.some((x) => x.startsWith("--output"));
    if (word === "find") return !args.some((x) => /^-(exec|ok|delete|fprint|fls|fprintf)/.test(x));
    return READ_ONLY.has(word);
  };
  return segments.every(simple) ? "never" : "ask";
}

export function shellTools(store: Store, home: string, apxPort?: number): Tool[] {
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
      confirm: (a) => commandRisk(a.command, apxPort),
      // Covers the longest foreground wait plus the time to stop the process.
      deadlineMs: 615_000,
      title: (a) => `Ran ${String(a.command ?? "").slice(0, 60)}`,
      async run(a, ctx) {
        // A code thread works in its own folder; any other thread in its project's root.
        const base = ctx.thread.cwd ?? baseDir(ctx.thread.project_id);
        const cwd = path.resolve(base, a.cwd ?? ".");
        // Links resolved: a symlink inside the project must not run the command somewhere else.
        if (!insideReal(base, a.cwd ?? ".")) return `refused: ${a.cwd} is outside the project folder`;
        // APX's own home (database, secrets index, job logs) is never an agent's to read or change.
        if (a.command.includes(home) || /\.apx2\b/.test(a.command)) return "refused: APX's own folder is off limits";
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
