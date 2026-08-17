// apx command — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdCommandList, cmdCommandShow } from "../commands/command.js";

// Aliases accepted for this command. Declared here, next to the command
// itself — a global alias table would be wrong, since the same word means
// different things under different commands ("rm" is remove under `agent`,
// unset under `project config`, revoke under `pair`).
export const aliases = ["commands"];

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (!sub || sub === "list" || sub === "ls") await cmdCommandList(a);
  else if (sub === "show" || sub === "get") await cmdCommandShow(a);
  else die(`unknown command subcommand: ${sub}`);
}
