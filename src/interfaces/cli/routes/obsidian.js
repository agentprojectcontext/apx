// apx obsidian — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdObsidianRemove, cmdObsidianSet, cmdObsidianStatus, cmdObsidianSync } from "../commands/obsidian.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (!sub || sub === "status" || sub === "show") await cmdObsidianStatus(a);
  else if (sub === "set" || sub === "connect" || sub === "add") await cmdObsidianSet(a);
  else if (sub === "sync") await cmdObsidianSync(a);
  else if (sub === "remove" || sub === "rm" || sub === "disconnect") await cmdObsidianRemove(a);
  else die(`unknown obsidian subcommand: ${sub}\nUsage: apx obsidian <set|status|sync|remove> [--global|--project <p>]`);
}
