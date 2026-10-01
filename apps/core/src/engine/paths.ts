// Paths an external agent's tool call touches, and whether they stay inside the folder it works in.
import fs from "node:fs";
import path from "node:path";

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

/** The real location of a path that may not exist yet: its nearest existing ancestor resolved, the rest appended. */
function real(p: string): string {
  let cur = p;
  const rest: string[] = [];
  for (let i = 0; i < 64; i++) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse());
    } catch {
      rest.push(path.basename(cur));
      const up = path.dirname(cur);
      if (up === cur) return p;
      cur = up;
    }
  }
  return p;
}

/** Whether `p` (relative to `base`) is inside `base` once links are resolved. */
export function insideReal(base: string, p: string): boolean {
  const root = real(base);
  const target = real(path.resolve(base, p));
  return target === root || target.startsWith(`${root}${path.sep}`);
}

/**
 * Files no automatic edit may touch: git's own config (it can run commands), APC definitions (an agent could raise
 * its own autonomy) and the project's instructions.
 */
export function guarded(base: string, p: string): boolean {
  const rel = path.relative(real(base), real(path.resolve(base, p)));
  const first = rel.split(path.sep)[0] ?? "";
  return first === ".git" || first === ".apc" || rel === "AGENTS.md";
}
