// Paths an external agent's tool call touches, and whether they stay inside the folder it works in.
import path from "node:path";
import { APX_DIR, CHECKOUTS, LEGACY_DIR } from "../apc/folder.ts";
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

/** A project's APX files: `.apx/`, and `.apc/` while it is still there to move, both except their worktrees. */
const DEFINITIONS: ReadonlySet<string> = new Set([APX_DIR, LEGACY_DIR]);

/**
 * Files no automatic edit may touch: git's own config (it can run commands), the project's agent files and Claude
 * Code's settings (an agent could raise its own autonomy) and the project's instructions.
 */
export function guarded(base: string, p: string): boolean {
  const rel = path.relative(real(base), real(path.resolve(base, p)));
  const parts = rel.split(path.sep);
  return (
    parts[0] === ".git" ||
    (DEFINITIONS.has(parts[0] ?? "") && !CHECKOUTS.has(parts[1] ?? "")) ||
    rel === "AGENTS.md" ||
    harnessSettings(parts)
  );
}

/** Claude Code's own permission files: editing them would let a session widen what it may do unasked. */
const harnessSettings = (parts: string[]): boolean =>
  parts.at(-2) === ".claude" && /^settings(\.local)?\.json$/.test(parts.at(-1) ?? "");

/**
 * Whether a path as written names a project's agent files (an `.apx` folder that is not a worktree's), an AGENTS.md
 * or Claude Code's settings files.
 */
export function namesAgentFiles(p: string): boolean {
  const parts = path.normalize(p).split(/[\\/]/).filter(Boolean);
  const at = parts.findIndex((s) => DEFINITIONS.has(s));
  return (at >= 0 && !CHECKOUTS.has(parts[at + 1] ?? "")) || parts.at(-1) === "AGENTS.md" || harnessSettings(parts);
}
