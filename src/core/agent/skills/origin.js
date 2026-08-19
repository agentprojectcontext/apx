// Where a skill's files actually live — APX may only hold a symlink.
//
// `source` is the APX layer (builtin / global / project). `origin` is the
// host that owns the bytes: claude, cursor, codex, agents, or APX itself.
// The UI badge uses origin so a linked-in Claude skill does not look like
// "you wrote this in ~/.apx/skills".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SKILL_ORIGIN_HOSTS = Object.freeze([
  ["claude", [".claude", "skills"]],
  ["cursor", [".cursor", "skills"]],
  ["codex", [".codex", "skills"]],
  ["agents", [".agents", "skills"]],
]);

function realOrResolve(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function homeRelLiteral(p, home) {
  const abs = path.resolve(p);
  const root = path.resolve(home);
  if (abs === root) return "~";
  if (abs.startsWith(root + path.sep)) return "~" + abs.slice(root.length);
  return abs;
}

export function homeRel(p, home = os.homedir()) {
  const abs = realOrResolve(p);
  const root = realOrResolve(home);
  if (abs === root) return "~";
  if (abs.startsWith(root + path.sep)) return "~" + abs.slice(root.length);
  return abs;
}

/**
 * @param {string} file  path to SKILL.md (or a flat <slug>.md)
 * @param {{ source?: string, home?: string }} [opts]
 * @returns {{ origin: string, origin_path: string, file_path: string }}
 */
export function skillOrigin(file, { source, home = os.homedir() } = {}) {
  const filePath = homeRelLiteral(file, home);
  if (source === "builtin") return { origin: "apx", origin_path: filePath, file_path: filePath };
  if (source === "project") return { origin: "project", origin_path: filePath, file_path: filePath };

  let realFile = file;
  try { realFile = fs.realpathSync(file); } catch { /* broken link — fall through */ }
  const originPath = homeRel(realFile, home);
  const realDir = path.dirname(realOrResolve(realFile));

  for (const [origin, segs] of SKILL_ORIGIN_HOSTS) {
    const host = path.resolve(home, ...segs);
    const hostReal = fs.existsSync(host) ? realOrResolve(host) : host;
    if (realDir === hostReal || realDir.startsWith(hostReal + path.sep)) {
      return { origin, origin_path: originPath, file_path: filePath };
    }
  }
  return { origin: "global", origin_path: originPath, file_path: filePath };
}
