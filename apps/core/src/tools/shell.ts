// shell: an agent runs a command on the owner's machine, in its project's folder. Commands that only read run like
// any tool; anything else waits for the owner (unless the agent's autonomy is total); destructive ones always do.
// Commands get an environment without secret-looking variables (harness/env.ts) and cannot name APX's home.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { insideReal } from "../paths.ts";
import { commandShell } from "../processes.ts";
import { namedPaths } from "./command-paths.ts";
import { readsOnly } from "./command-reads.ts";
import {
  type Access,
  folderAccess,
  type JudgeOptions,
  judge,
  missingCwd,
  namesApxHome,
  outsideFolders,
  type Root,
  refusal,
  rootsOf,
  scratchRoot,
} from "./folders.ts";
import { untrusted } from "./result.ts";
import { type Confirm, defineTool, type Tool } from "./types.ts";

const DESTRUCTIVE =
  /\b(sudo|su|doas|mkfs|dd|shutdown|reboot|halt|diskutil|launchctl|crontab|shred|srm)\b|\brm\b[^|;&]*\s(-\w*[rf]|--recursive|--force)|\bgit\b[^|;&]*\s(push|reset\s+--hard|clean\b|filter-branch|update-ref\s+-d)|\b(curl|wget|fetch)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\bchmod\b[^|;&]*\s-\w*R|\bchown\b[^|;&]*\s-\w*R|:\(\)\s*\{|\/dev\/(sd|disk|nvme)/;

/** The command as the shell will mostly see it: quotes and escapes dropped, paths to programs reduced to names. */
const normalize = (c: string) =>
  c
    .replace(/\\\n/g, " ")
    .replace(/["'\\]/g, "")
    .replace(/(^|[\s;&|(])\/(?:[\w.-]+\/)*([\w.-]+)/g, "$1$2");

/** Programs that walk a whole folder tree; grep and ls only with a recursive flag. */
const WALKERS = new Set(["find", "fd", "rg", "du", "tree"]);
const RECURSIVE = { grep: /^-(\w*[rR]\w*|-recursive)$/, ls: /^-\w*R\w*$/ } as const;
/** Folders whose children are whole disks, home folders or top-level system folders (/usr, /Library). */
const MOUNTS = new Set(["/", "/Volumes", "/Users", "/home", "/mnt", "/media", "/run/media"]);

/**
 * The folder a command would walk when it is a whole disk, a top-level folder or a home folder, else undefined. Such a walk takes minutes
 * and reads everything the owner keeps, whatever the agent was looking for.
 */
export function broadScan(command: string, home = os.homedir()): string | undefined {
  for (const segment of command.split(/[;&|\n]|\$\(/)) {
    const [word = "", ...args] = segment.replace(/["']/g, "").trim().split(/\s+/);
    const program = path.basename(word);
    const walks =
      WALKERS.has(program) ||
      ((program === "grep" || program === "ls") && args.some((a) => RECURSIVE[program].test(a)));
    if (!walks) continue;
    for (const arg of args) {
      const expanded = arg.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home);
      if (!path.isAbsolute(expanded)) continue;
      // A /… path keeps its Unix meaning on Windows too (Git Bash); a drive's root is a whole disk.
      const at = expanded.startsWith("/") ? path.posix.resolve(expanded) : path.resolve(expanded);
      const drive = /^[a-z]:[\\/]?$/i.test(at) || (process.platform === "win32" && /^\/[a-z]\/?$/i.test(at));
      if (drive || at === home || at === path.dirname(home) || MOUNTS.has(at) || MOUNTS.has(path.dirname(at)))
        return at;
    }
  }
  return undefined;
}

/**
 * How much the owner must be asked for this command. Commands that only read on this machine run without asking
 * (DECISIONS.md#d-098); anything the classifier cannot be sure of asks.
 */
export function commandRisk(command: string, apxPort?: number): Confirm {
  const c = command.trim();
  if (DESTRUCTIVE.test(c) || DESTRUCTIVE.test(normalize(c))) return "always";
  // A command that talks to APX's own API could act as the owner (answer its own confirmation): always asked.
  if (apxPort && new RegExp(`(127\\.0\\.0\\.1|localhost|\\[::1\\]|0\\.0\\.0\\.0):${apxPort}\\b`).test(c))
    return "always";
  // So does APX's own CLI, which finds the port by itself.
  if (/(^|[\s;&|(`])([\w./~-]*\/)?(apx|[\w./-]*apps\/terminal\/src\/main\.ts)(\s|$)/.test(c)) return "always";
  // Only reading, here: where it reads is the folder rule's to judge (commandFolder), not the owner's to approve.
  return readsOnly(c) ? "never" : "ask";
}

/**
 * Whether a command may bring in text from outside this computer: a URL, a network program, an install or a git
 * fetch. Without one, its output (a build, a test run) is the project's own, as file_read's is (DECISIONS.md#d-109).
 */
export function reachesOut(command: string): boolean {
  return NETWORK.test(command);
}

const NETWORK =
  /(\w+:\/\/|(^|[\s;&|(`])(curl|wget|ssh|scp|rsync|nc|ncat|telnet|ftp|sftp|gh|aws|gcloud|az|kubectl|docker|podman|ollama|apx)(\s|$)|\b(npm|pnpm|yarn|bun|pip3?|uv|poetry|cargo|go|gem|bundle|composer|brew|apt(-get)?)\s+(i|install|add|update|upgrade|get|fetch|sync|publish|dlx|x|create|init)\b|\b(npx|pnpx|bunx|uvx)\b|\bgit\s+(fetch|pull|clone|push|ls-remote|submodule)\b)/i;

/** Programs, libraries, devices and system settings a command may read or run (`/usr/bin/env`, `/etc/hosts`). */
const PLUMBING =
  /^\/(dev|usr|bin|sbin|opt|System|nix|etc|private\/etc|Applications|Library|proc|sys|lib|lib32|lib64|libx32|snap)(\/|$)/;
/** Where output may always go: it lands nowhere on disk. */
const SINK = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/;

/**
 * Why the folder rule refuses a command line run from `cwd`, or undefined: each path it reads must be readable and
 * each it writes writable, from where it runs after its `cd`s. Words whose place only the shell knows cannot write
 * while a read-only folder is there to protect; without one, commandRisk already asks the owner about them.
 */
export function judgeCommand(
  roots: Root[],
  command: string,
  cwd: string,
  o: Omit<JudgeOptions, "write" | "name"> & { userHome?: string; strict?: boolean } = {},
): Extract<Access, { refused: string }> | undefined {
  // Reading anywhere is not a folder to protect: only a read-only folder the owner named (or one lent) is; `strict`
  // refuses those words anyway.
  const locked = o.strict === true || roots.some((r) => !r.write && !r.off && !r.anywhere);
  const unknown = (what: string) => (locked ? { refused: refusal.unknown(what) } : undefined);
  let from: string | undefined = cwd;
  let old: string | undefined;
  for (const n of namedPaths(command, o.userHome)) {
    if (n.kind === "unknown") {
      if (n.write) return unknown(n.text);
      continue;
    }
    if (n.kind === "here") {
      if (from === undefined) {
        if (n.known && locked) return unknown("this command");
        continue;
      }
      // Any program may write where it runs; refused only in a read-only folder.
      const r = judge(roots, ".", from);
      if (!("refused" in r) && !r.write) return { refused: refusal.readOnly(from) };
      continue;
    }
    const to = n.to;
    const base = to?.old ? old : from;
    if (n.kind === "cd") old = from;
    if (!to || (base === undefined && (to.old || !path.isAbsolute(to.path)))) {
      if (n.kind === "cd") from = undefined;
      else if (n.write) return unknown(to?.path ?? "a path");
      continue;
    }
    const at = path.resolve(base ?? "/", to.path);
    const write = n.kind === "path" && n.write;
    // On Windows Git Bash's /dev and /usr keep their Unix names; resolving them would invent a C:\dev.
    const named = to.path.startsWith("/") ? path.posix.normalize(to.path) : at;
    if (write ? SINK.test(named) : PLUMBING.test(named)) {
      if (n.kind === "cd") from = at;
      continue;
    }
    const r = judge(roots, to.path, base ?? "/", { ...o, write, name: to.path });
    if ("refused" in r) return r;
    if (n.kind === "cd") from = r.at;
  }
  return undefined;
}

/**
 * Where a command runs, or why the folder rule file_read follows refuses it: its cwd, or a path it reads or writes,
 * taken from where it runs (after its `cd`s).
 */
export function commandFolder(
  store: Store,
  home: string,
  thread: Parameters<typeof folderAccess>[2],
  a: { command: string; cwd?: string | undefined },
): Access {
  const where = folderAccess(store, home, thread, a.cwd ?? ".");
  if ("refused" in where) return where;
  const roots = rootsOf(store, home, thread);
  return judgeCommand(roots, a.command, where.at, { home, project: Boolean(thread.project_id) }) ?? where;
}

/** How long a background job may run when the agent does not say: servers and watchers pass a longer timeout_s. */
const BACKGROUND_S = 3600;

export function shellTools(store: Store, home: string, apxPort: () => number): Tool[] {
  return [
    defineTool({
      name: "shell",
      description: `Run a ${commandShell().name} command in the project's folder. In the foreground it waits up to timeout_s and returns the output; background=true returns a job id at once, and the end of its output reaches you in a new turn when it ends (servers, long builds, watchers). Commands that change things may wait for the owner's OK.`,
      args: z.object({
        command: z
          .string()
          .min(1)
          .max(4000)
          .superRefine((c, ctx) => {
            const at = broadScan(c);
            if (at)
              ctx.addIssue({
                code: "custom",
                message: `refused: this walks all of ${at}. Search a specific folder; to find what you or another agent did, use search_chats`,
              });
          }),
        background: z.boolean().optional(),
        timeout_s: z
          .number()
          .int()
          .min(1)
          .max(86_400)
          .optional()
          .describe("default 120 in the foreground (at most 600); a background job stops after it, default 3600"),
        cwd: z
          .string()
          .max(500)
          .optional()
          .describe("relative to the project, or an absolute temp or read-only folder"),
      }),
      effect: "external",
      confirm: (a) => commandRisk(a.command, apxPort()),
      // A command that could only be refused is not put to the owner.
      check(a, ctx) {
        const missing = missingCwd(store, home, ctx.thread, a.cwd);
        if (missing) throw new Error(missing);
        const r = commandFolder(store, home, ctx.thread, a);
        if ("refused" in r) throw new Error(`refused: ${r.refused}`);
      },
      outside: (a, ctx) =>
        missingCwd(store, home, ctx.thread, a.cwd)
          ? []
          : outsideFolders((lent) => commandFolder(store, home, { ...ctx.thread, lent }, a)),
      workspace: true,
      // Run in a temp folder, writing only there and reaching nothing outside: its own scratch work.
      scratch: (a) => {
        const temp = scratchRoot(home);
        // Its cwd, or the folder the command starts by going into (`cd /…/apx-scratch-…/x && …`).
        const at = a.cwd ?? /^\s*cd\s+(["']?)([^"'\s;&|]+)\1\s*(&&|;)/.exec(a.command)?.[2];
        if (!at || !path.isAbsolute(at) || !insideReal(temp, at) || reachesOut(a.command)) return false;
        if (commandRisk(a.command, apxPort()) === "always") return false;
        const roots: Root[] = [
          { dir: temp, write: true, scratch: true },
          { dir: path.parse(home).root, write: false, scratch: false, anywhere: { home } },
        ];
        return !judgeCommand(roots, a.command, at, { home, strict: true });
      },
      local: (a) => !a.background && (commandRisk(a.command, apxPort()) === "never" || !reachesOut(a.command)),
      reads: (a) => commandRisk(a.command, apxPort()) === "never",
      // Covers the longest foreground wait plus the time to stop the process.
      deadlineMs: 615_000,
      title: (a) => `Ran ${String(a.command ?? "").slice(0, 60)}`,
      async run(a, ctx) {
        // Links resolved: a symlink inside the project must not run the command somewhere else.
        const where = commandFolder(store, home, ctx.thread, a);
        if ("refused" in where) return `refused: ${where.refused}`;
        const { base, at: cwd } = where;
        const limit = a.background ? (a.timeout_s ?? BACKGROUND_S) : Math.min(a.timeout_s ?? 120, 600);
        // APX's own home (database, secrets index, job logs) is never an agent's to read or change.
        if (namesApxHome(a.command, home, ctx.thread.project_id)) return "refused: APX's own folder is off limits";
        if (cwd === base) fs.mkdirSync(base, { recursive: true });
        else if (!fs.existsSync(cwd)) return `${a.cwd} does not exist`;
        const r = await ctx.runCommand({
          command: a.command,
          cwd,
          background: a.background ?? false,
          timeoutMs: limit * 1000,
        });
        if (a.background)
          return `started job ${r.job.id} in the background (${cwd}); it stops after ${limit}s. You will get the end of its output when it ends; shell_output reads it now.`;
        const exit = r.job.state === "canceled" ? `stopped after ${limit}s` : `exit ${r.job.exit_code ?? "?"}`;
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
