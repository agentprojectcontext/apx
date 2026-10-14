// shell: an agent runs a command on the owner's machine, in its project's folder. Commands that only read run like
// any tool; anything else waits for the owner (unless the agent's autonomy is total); destructive ones always do.
// Commands get an environment without secret-looking variables (harness/env.ts) and cannot name APX's home.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
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
      const at = path.resolve(expanded);
      if (at === home || at === path.dirname(home) || MOUNTS.has(at) || MOUNTS.has(path.dirname(at))) return at;
    }
  }
  return undefined;
}

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
  // So does APX's own CLI, which finds the port by itself.
  if (/(^|[\s;&|(`])([\w./~-]*\/)?(apx|[\w./-]*apps\/terminal\/src\/main\.ts)(\s|$)/.test(c)) return "always";
  // Pipes, && and ; between simple commands are fine; any other shell syntax is not judged, it is asked.
  const segments = c.split(/&&|\|\||\||;/).map((x) => x.trim());
  const simple = (raw: string): boolean => {
    // Quoted plain text ('*.png', "two words") is an argument like any other; `\(` `\)` only group find's tests.
    let seg = raw.replace(/'([^'"]*)'|"([^'"$`\\]*)"/g, (_m, s?: string, d?: string) => s ?? d ?? "");
    if (/^find\s/.test(seg)) seg = seg.replace(/(^|\s)\\[()](?=\s|$)/g, " ");
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

/**
 * APX's own folder for a project, so one project's files never land among another's: the project's folder when APX
 * made it (a project with no folder elsewhere lives in `projects/<name>`), else `projects/<id>`.
 */
export function projectSide(home: string, project: { id: string; path?: string | undefined }) {
  const projects = path.join(home, "projects");
  const own = project.path && path.relative(projects, project.path);
  return own && !own.startsWith("..") && !path.isAbsolute(own)
    ? (project.path as string)
    : path.join(projects, project.id);
}

/**
 * Where an agent works in a thread: a code thread's own folder, else its project's folder when it is on disk, else
 * APX's side of the project, else (a chat outside a project) APX's work folder. Commands run and files are written
 * only inside it, or in the chat's temp folder (scratchDir).
 */
export function workDir(
  store: Store,
  home: string,
  thread: { cwd?: string | undefined; project_id?: string | undefined },
) {
  if (thread.cwd) return thread.cwd;
  const p = thread.project_id ? store.projects.get(thread.project_id) : undefined;
  if (!p) return path.join(home, "work");
  return p.path && p.present ? p.path : projectSide(home, p);
}

/**
 * Where an outside agent (Claude, Codex, an ACP agent) works: a code thread's folder, else APX's side of the project,
 * never the project's own folder (its settings there would apply unchecked), else APX's work folder.
 */
export function harnessDir(
  store: Store,
  home: string,
  thread: { cwd?: string | undefined; project_id?: string | undefined },
) {
  if (thread.cwd) return thread.cwd;
  const p = thread.project_id ? store.projects.get(thread.project_id) : undefined;
  return p ? projectSide(home, p) : path.join(home, "work");
}

/**
 * Where a chat keeps temporary files: a folder of its own (shared with the sub-chats it delegated to) in the system's
 * temp folder, outside the folder it works in and outside APX's home, so neither fills with downloads and test scripts.
 */
export function scratchDir(store: Store, home: string, thread: { id: string; parent_id?: string | undefined }) {
  let root = thread;
  for (let i = 0; root.parent_id && i < 10; i++) root = store.threads.get(root.parent_id) ?? { id: root.id };
  return path.join(scratchRoot(home), root.id.replace(/[^\w-]/g, "_"));
}

/** Every chat's temp folder sits here; one per APX home, so a test core never shares the owner's. */
export const scratchRoot = (home: string) =>
  path.join(os.tmpdir(), `apx-scratch-${createHash("sha256").update(home).digest("hex").slice(0, 8)}`);

/**
 * A file an agent names: relative or absolute inside the folder it works in, or absolute inside its temp folder.
 * `base` is the folder it is in; undefined when it is in neither (links resolved).
 */
export function locateFile(
  store: Store,
  home: string,
  thread: Parameters<typeof workDir>[2] & Parameters<typeof scratchDir>[2],
  file: string,
): { base: string; at: string; scratch: boolean } | undefined {
  const work = workDir(store, home, thread);
  if (!path.isAbsolute(file))
    return insideReal(work, file) ? { base: work, at: path.resolve(work, file), scratch: false } : undefined;
  if (insideReal(work, file)) return { base: work, at: path.resolve(file), scratch: false };
  const scratch = scratchDir(store, home, thread);
  return insideReal(scratch, file) ? { base: scratch, at: path.resolve(file), scratch: true } : undefined;
}

/** How long a background job may run when the agent does not say: servers and watchers pass a longer timeout_s. */
const BACKGROUND_S = 3600;

export function shellTools(store: Store, home: string, apxPort: () => number): Tool[] {
  return [
    defineTool({
      name: "shell",
      description:
        "Run a sh command in the project's folder. In the foreground it waits up to timeout_s and returns the output; background=true returns a job id at once, and the end of its output reaches you in a new turn when it ends (servers, long builds, watchers). Commands that change things may wait for the owner's OK.",
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
          .describe("folder inside the project, relative; or your temp folder (absolute)"),
      }),
      effect: "external",
      confirm: (a) => commandRisk(a.command, apxPort()),
      workspace: true,
      local: (a) => !a.background && commandRisk(a.command, apxPort()) === "never",
      // Covers the longest foreground wait plus the time to stop the process.
      deadlineMs: 615_000,
      title: (a) => `Ran ${String(a.command ?? "").slice(0, 60)}`,
      async run(a, ctx) {
        // Links resolved: a symlink inside the project must not run the command somewhere else.
        const where = locateFile(store, home, ctx.thread, a.cwd ?? ".");
        if (!where) return `refused: ${a.cwd} is outside the project folder and your temp folder`;
        const { base, at: cwd } = where;
        const limit = a.background ? (a.timeout_s ?? BACKGROUND_S) : Math.min(a.timeout_s ?? 120, 600);
        // APX's own home (database, secrets index, job logs) is never an agent's to read or change.
        if (a.command.includes(home) || /\.apx(2\b|\/v2\b)/.test(a.command))
          return "refused: APX's own folder is off limits";
        if (cwd === base) fs.mkdirSync(base, { recursive: true });
        else if (!fs.existsSync(cwd)) return `no folder ${a.cwd} in the project`;
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
