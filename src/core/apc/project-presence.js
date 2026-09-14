// Whether a registered project is still on disk — and, when it is not, where it
// probably went.
//
// A project is registered by PATH and nothing else: `~/.apx/config.json` stores
// `{"path": "…"}`, with no name and no id. Everything else is DERIVED by reading
// `.apc/project.json` at that path. So when a folder is renamed or moved, every
// derivation quietly falls back instead of failing: the name becomes the
// basename of the path that no longer exists, `readAgents()` finds no directory
// and answers 0, and `rebuild` reports "0 agents" with a zero exit code.
//
// That is how renaming `/proyectos_varios/knot` to `/proyectos_varios/cheto`
// turned a project called "Cheto" with eight agents back into "knot" with none.
// Nothing in the CLI or the panel said a word, so the only reading available to
// the user was that the rename had reverted itself.
//
// The fix is not to stop deriving — the path really is the only registration —
// but to make ABSENCE a reportable state instead of a silent default.
import fs from "node:fs";
import path from "node:path";
import { apcProjectFile } from "./paths.js";

/**
 * Is this project still readable where it was registered?
 *
 * Two different absences, because they need different answers: a folder that is
 * gone probably MOVED (offer to reattach it), while a folder that is still there
 * without `.apc/project.json` was de-initialized or is a stale registration.
 *
 * @param {string} root absolute project path as registered
 * @returns {{missing: false} | {missing: true, reason: string}}
 */
export function projectPresence(root) {
  const abs = path.resolve(String(root || ""));
  if (!abs || !fs.existsSync(abs)) {
    return { missing: true, reason: "the folder no longer exists" };
  }
  if (!fs.existsSync(apcProjectFile(abs))) {
    return { missing: true, reason: "the folder is there but has no .apc/project.json" };
  }
  return { missing: false };
}

// How many sibling directories we are willing to open per root. A project's
// parent holds tens of folders; a temp dir or a home directory can hold tens of
// thousands, and this runs on the error path of `rebuild`, where the user is
// already waiting to be told something went wrong. Best-effort by design: the
// answer when we give up is "pass the path yourself", which always works.
const MAX_SIBLINGS_SCANNED = 400;

/**
 * The folder a moved project probably went to: one whose `.apc/project.json`
 * carries the SAME `apx_id`.
 *
 * Matching the apx_id is conclusive rather than a guess — it is the identity the
 * per-project storage hangs off (`~/.apx/projects/<apx_id>/`), so a folder that
 * carries it IS this project, whatever it is called now.
 *
 * Siblings of the old path only (plus any `extraRoots` a caller already knows
 * about). Sweeping the disk for a match is not something `project list` can
 * afford to do per row, and the case that actually happens — a folder renamed
 * in place — never leaves its parent directory.
 *
 * @returns {{path: string, name: string} | null}
 */
export function findMovedProject(oldPath, apxId, { extraRoots = [] } = {}) {
  if (!apxId) return null; // nothing to match on: a guess by name would be worse
  const abs = path.resolve(String(oldPath || ""));
  const seen = new Set([abs]);

  for (const dir of [path.dirname(abs), ...extraRoots]) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable parent — the other roots may still answer
    }
    let scanned = 0;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (++scanned > MAX_SIBLINGS_SCANNED) break;
      const candidate = path.join(dir, e.name);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      // Cheaper than letting readFileSync throw, and this loop runs hundreds of
      // times over folders that are mostly not projects at all.
      if (!fs.existsSync(apcProjectFile(candidate))) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(apcProjectFile(candidate), "utf8"));
        if (meta.apx_id && String(meta.apx_id) === String(apxId)) {
          return { path: candidate, name: meta.name || path.basename(candidate) };
        }
      } catch {
        // Not a project, or unreadable. Keep looking — one bad sibling must not
        // end the search.
      }
    }
  }
  return null;
}

/**
 * The sentence to show a user whose project has gone missing: what happened and
 * the exact command that fixes it.
 *
 * Shared so the CLI, the API error and the panel all say the same thing. The
 * command is named in full WITH the id, because the id is the one piece the
 * user cannot guess and the whole point of `relink` is that it survives.
 */
export function missingProjectAdvice(entry, presence, moved) {
  const where = moved
    ? `It looks like it moved to ${moved.path} — reattach it with \`apx project relink ${entry.id}\`.`
    : `Point it at its new folder with \`apx project relink ${entry.id} <path>\`, which keeps its id and its data.`;
  return `project #${entry.id} (${entry.path}): ${presence.reason}. ${where}`;
}
