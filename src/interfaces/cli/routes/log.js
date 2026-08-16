// apx log — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdLog } from "../commands/log.js";

// Aliases accepted for this command. Declared here, next to the command
// itself — a global alias table would be wrong, since the same word means
// different things under different commands ("rm" is remove under `agent`,
// unset under `project config`, revoke under `pair`).
export const aliases = ["logs"];

export default async function route(rest, { parseArgs }) {
  // `apx log` is the unified daemon log (everything: telegram, whisper,
  // super-agent, tools, desktop). For just the legacy stdout sink,
  // use `apx daemon logs`. `apx log -f` follows; `--errors` filters.
  await cmdLog(parseArgs(rest));
}
