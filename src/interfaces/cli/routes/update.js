// apx update — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdUpdate } from "../commands/update.js";

// Aliases accepted for this command. Declared here, next to the command
// itself — a global alias table would be wrong, since the same word means
// different things under different commands ("rm" is remove under `agent`,
// unset under `project config`, revoke under `pair`).
export const aliases = ["upgrade"];

export default async function route(rest, { parseArgs, VERSION }) {
  await cmdUpdate(parseArgs(rest), VERSION);
  return; // skip checkForUpdate after an update

  // Refresh everything held in memory after a code change (e.g. a `git
  // pull` in a dev checkout): restart the daemon, and restart the desktop
  // too if it was running. The daemon picks up new code/prompts; the
  // desktop picks up its new renderer/main.js. Token re-sync is automatic
  // (the desktop WS re-reads daemon.token on reconnect).
}
