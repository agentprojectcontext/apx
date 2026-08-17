// apx config — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdConfigSet, cmdConfigShow, cmdConfigUnset } from "../commands/config.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (sub === "show" || sub === "ls" || sub === undefined) await cmdConfigShow(a);
  else if (sub === "set") await cmdConfigSet(a);
  else if (sub === "unset" || sub === "rm") await cmdConfigUnset(a);
  else die(`unknown config subcommand: ${sub}`);
}
