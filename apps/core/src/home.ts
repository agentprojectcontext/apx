// v2 moved its state from ~/.apx2 into ~/.apx/v2, beside v1's files (never touching them). The move happens once,
// before the store opens: a rename on the same disk, so it is all or nothing. See DECISIONS.md#d-024
import fs from "node:fs";
import path from "node:path";

/** Moves the old home to the new one when only the old one exists; says what it did. */
export function moveLegacyHome(o: { home: string; legacy: string; explicit: boolean }): "moved" | "none" {
  // A home the owner set (APX_HOME) is theirs; an existing new home is never replaced.
  if (o.explicit || fs.existsSync(o.home) || !fs.existsSync(o.legacy)) return "none";
  fs.mkdirSync(path.dirname(o.home), { recursive: true });
  fs.renameSync(o.legacy, o.home);
  return "moved";
}
