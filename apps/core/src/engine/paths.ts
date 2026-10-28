// Paths an external agent's tool call touches, and whether they stay inside the folder it works in.
import path from "node:path";
import { real } from "../paths.ts";

/** Every path a tool input names, under the keys agents use (Claude, OpenCode, Gemini/Qwen, ACP locations). */
export function pathsOf(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const o = input as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ["path", "file_path", "filepath", "filePath", "notebook_path", "directory", "dir_path"])
    if (typeof o[k] === "string" && o[k]) out.push(o[k] as string);
  if (Array.isArray(o.locations))
    for (const l of o.locations) if (typeof l?.path === "string" && l.path) out.push(l.path);
  return out;
}

/** A path inside a `.git` folder: no agent's file tool touches it, whoever runs the loop; git runs through commands. */
export const inGitFolder = (p: string): boolean => p.split(/[\\/]/).includes(".git");

/**
 * Files no automatic edit may touch: git's own config (it can run commands), APC definitions (an agent could raise
 * its own autonomy) and the project's instructions.
 */
export function guarded(base: string, p: string): boolean {
  const rel = path.relative(real(base), real(path.resolve(base, p)));
  const parts = rel.split(path.sep);
  return parts[0] === ".git" || (parts[0] === ".apc" && !CHECKOUTS.has(parts[1] ?? "")) || rel === "AGENTS.md";
}

/** Folders under `.apc` where agents keep git worktrees: a checkout of the code, not the project's APC definitions. */
const CHECKOUTS = new Set(["worktree", "worktrees"]);

/** Whether a path as written names APC definitions (a `.apc` folder that is not a worktree's) or an AGENTS.md. */
export function namesApc(p: string): boolean {
  const parts = path.normalize(p).split(/[\\/]/).filter(Boolean);
  const at = parts.indexOf(".apc");
  return (at >= 0 && !CHECKOUTS.has(parts[at + 1] ?? "")) || parts.at(-1) === "AGENTS.md";
}
