// What a task's own runs show its assignee did, read when they close it as done: a close backed only by documents
// (a plan, decision notes) is checked once, since a task that asked for a change is not done by describing it; so is a
// close that leaves the work uncommitted in a worktree of its own, where nobody else would find it.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Task } from "@apx/protocol";
import type { RunRecord as Run, Step } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { expandHome } from "../paths.ts";
import { workDir } from "./folders.ts";

const git = promisify(execFile);
const DOCUMENT = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
/** Tools that change the project or check it: what a code task's work goes through. */
const WORK = new Set(["file_write", "file_edit", "shell"]);

const text = (v: unknown) => (typeof v === "string" ? v : undefined);
const pathOf = (s: Step) => text(s.args.path) ?? "";

/** The assignee's runs on the task (its chat and the sessions it opened) with their helpers', newest first. */
function taskRuns(store: Store, task: Task): Run[] {
  const threads = [task.thread_id, ...store.threads.byTask(task.id).map((t) => t.id)];
  return [...new Set(threads)]
    .flatMap((id) => store.runs.list(id, 50))
    .filter((r) => r.agent_id === task.assignee)
    .flatMap((r) => [r, ...store.runs.children(r.id)]);
}

const workSteps = (store: Store, r: Run) =>
  store.runs
    .steps(r.id)
    .filter((s) => s.state === "ok" && s.effect !== "none")
    .filter((s) => WORK.has(s.tool) || s.tool.startsWith("external:"));

/** The documents the task's work wrote, when that is all it changed and it ran no command; else undefined. */
export function documentsOnly(store: Store, task: Task): string[] | undefined {
  const work = taskRuns(store, task).flatMap((r) => workSteps(store, r));
  const docs = work.filter((s) => s.tool !== "shell" && DOCUMENT.test(pathOf(s)));
  if (!docs.length || docs.length < work.length) return undefined;
  return [...new Set(docs.map(pathOf))];
}

/** The folders a run's file writes and commands worked in, resolved as the tools did from the folder it works in. */
function foldersOf(store: Store, home: string, r: Run): string[] {
  const thread = store.threads.get(r.thread_id);
  if (!thread) return [];
  const base = workDir(store, home, thread);
  const at = (file: string, cwd?: string) => path.resolve(base, expandHome(cwd ?? "."), expandHome(file));
  return workSteps(store, r).flatMap((s) => {
    const cwd = text(s.args.cwd);
    if (s.tool === "file_write" || s.tool === "file_edit") {
      return [path.dirname(at(pathOf(s), cwd))];
    }
    if (s.tool !== "shell") return [];
    // A command that starts by going into a folder (`cd .worktrees/x && …`) works there.
    const into = /^\s*cd\s+(["']?)([^"'\s;&|]+)\1\s*(&&|;)/.exec(text(s.args.command) ?? "")?.[2];
    return [into ? at(into, cwd) : at(".", cwd)];
  });
}

export type Uncommitted = { dir: string; branch: string; changes: number };

/**
 * The linked git worktrees the task's work changed that still hold uncommitted changes. Only worktrees: one is made
 * for a piece of work, so what is left there is that work's; the owner's own checkout may hold their changes.
 */
export async function uncommittedWork(store: Store, home: string, task: Task): Promise<Uncommitted[]> {
  const dirs = new Set(taskRuns(store, task).flatMap((r) => foldersOf(store, home, r)));
  const tops = new Map<string, string>();
  const run = async (dir: string, args: string[]) =>
    (await git("git", ["-C", dir, ...args], { timeout: 3_000, maxBuffer: 1 << 20 })).stdout;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const out = await run(dir, [
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
    ]).catch(() => "");
    const [top, gitDir, common] = out.trim().split("\n");
    if (top && gitDir && common && gitDir !== common) tops.set(top, top);
  }
  const left: Uncommitted[] = [];
  for (const top of tops.keys()) {
    const status = await run(top, ["status", "--porcelain"]).catch(() => "");
    const changes = status.split("\n").filter(Boolean).length;
    if (!changes) continue;
    const branch = (await run(top, ["branch", "--show-current"]).catch(() => "")).trim();
    left.push({ dir: top, branch, changes });
  }
  return left;
}
