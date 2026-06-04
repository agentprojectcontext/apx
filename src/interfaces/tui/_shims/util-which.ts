// Real, synchronous `which` shim for the APX TUI.
//
// OpenCode's `@/util/which` exports a tiny helper that resolves an executable
// name to its absolute path by scanning $PATH (honouring PATHEXT on Windows).
// The catch-all shim only returned `async () => undefined`, which broke the
// synchronous `.find(which)` calls in util/sound.ts and the lazy clipboard
// lookup. This provides a correct implementation so clipboard copy and sound
// playback pick real binaries.
import fs from "node:fs"
import path from "node:path"

function isExecutable(file: string): boolean {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile()) return false
    if (process.platform === "win32") return true
    // Owner/group/other execute bit
    return (stat.mode & 0o111) !== 0
  } catch {
    return false
  }
}

/**
 * Resolve `cmd` to an absolute executable path, or `undefined` when not found.
 * Absolute/relative paths are checked directly; bare names are searched on
 * $PATH. Synchronous so it can be used inside Array.prototype.find().
 */
export function which(cmd: string): string | undefined {
  if (!cmd) return undefined

  // Already a path
  if (cmd.includes("/") || cmd.includes("\\")) {
    return isExecutable(cmd) ? cmd : undefined
  }

  const pathEnv = process.env.PATH || process.env.Path || ""
  const dirs = pathEnv.split(path.delimiter).filter(Boolean)
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""]

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return undefined
}

export default which
