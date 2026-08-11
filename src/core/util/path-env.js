// PATH repair for processes APX spawns.
//
// When the daemon is booted from a GUI context — the launchd agent
// (dev.apx.desktop), a .app bundle, an IDE — it inherits launchd's minimal
// PATH: /usr/bin:/bin:/usr/sbin:/sbin. No Homebrew, no nvm, no pnpm. Every
// child we spawn then dies with ENOENT on binaries that work fine in a
// terminal:
//
//   - whisper-server.py → "No such file or directory: 'ffmpeg'" (mlx/faster
//     whisper shell out to ffmpeg to decode .oga/.webm)
//   - stdio MCP servers  → "spawn npx ENOENT" / "spawn node ENOENT"
//
// getApxRunner() in core/desktop/autostart.js already dodges this for the
// node binary itself by using an absolute process.execPath. This module is
// the same idea for everything spawned *below* that process.
//
// Extra dirs are APPENDED, never prepended: an inherited PATH that already
// resolves a binary keeps winning, we only fill the gaps.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Directories worth appending on this machine, in priority order. Only ones
 * that actually exist are returned, so PATH stays free of dead entries.
 */
export function extraBinDirs() {
  const home = os.homedir();
  // dirname(process.execPath) is the bin/ of the node currently running us —
  // under nvm/fnm/volta that's also where npm and npx live, which is exactly
  // what stdio MCP servers need.
  const candidates = process.platform === "win32"
    ? [path.dirname(process.execPath)]
    : [
        path.dirname(process.execPath),
        "/opt/homebrew/bin",      // Homebrew on Apple Silicon
        "/opt/homebrew/sbin",
        "/usr/local/bin",         // Homebrew on Intel, most manual installs
        "/usr/local/sbin",
        path.join(home, ".local", "bin"),
        path.join(home, "Library", "pnpm"),
        path.join(home, ".bun", "bin"),
        path.join(home, ".cargo", "bin"),
      ];
  return candidates.filter((dir) => {
    try { return fs.existsSync(dir); } catch { return false; }
  });
}

/**
 * `basePath` with every missing entry from extraBinDirs() appended.
 * @param {string} [basePath]  defaults to the current process PATH
 */
export function augmentedPath(basePath = process.env.PATH || "") {
  const sep = path.delimiter;
  const seen = new Set(basePath.split(sep).filter(Boolean));
  const additions = extraBinDirs().filter((dir) => !seen.has(dir));
  if (!additions.length) return basePath;
  return [...basePath.split(sep).filter(Boolean), ...additions].join(sep);
}

/**
 * An env object for child_process.spawn: process.env + `extra`, with PATH
 * repaired. A PATH supplied in `extra` is respected as the base and augmented
 * too, so callers can still pin their own dirs first.
 */
export function envWithPath(extra = {}) {
  const merged = { ...process.env, ...extra };
  // Windows env keys are case-insensitive and may arrive as "Path".
  const key = Object.keys(merged).find((k) => k.toUpperCase() === "PATH") || "PATH";
  merged[key] = augmentedPath(merged[key] || "");
  return merged;
}
