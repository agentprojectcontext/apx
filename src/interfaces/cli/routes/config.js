// apx config — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdConfigSet, cmdConfigShow, cmdConfigUnset } from "../commands/config.js";

export default async function route(rest, { parseArgs, die }) {
  // A leading flag means no subcommand was given: `apx config --global` is
  // `apx config show --global`. Without this the flag itself was read as the
  // subcommand name and died with "unknown config subcommand: --global".
  // (`--help` never reaches here — cli/index.js intercepts it first.)
  const hasSub = rest[0] !== undefined && !rest[0].startsWith("-");
  const sub = hasSub ? rest[0] : undefined;
  const a = parseArgs(hasSub ? rest.slice(1) : rest);
  if (sub === "show" || sub === "ls" || sub === undefined) await cmdConfigShow(a);
  else if (sub === "set") await cmdConfigSet(a);
  else if (sub === "unset" || sub === "rm") await cmdConfigUnset(a);
  else die(`unknown config subcommand: ${sub}`);
}
