// apx pair — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdPair, cmdPairList, cmdPairRevoke, cmdPairWeb } from "../commands/pair.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (!sub || sub === "new" || sub === "device" || sub === "deck") await cmdPair(a);
  else if (sub === "web") await cmdPairWeb(a);
  else if (sub === "list" || sub === "ls") await cmdPairList();
  else if (sub === "revoke" || sub === "rm") await cmdPairRevoke(a);
  else die(`unknown pair subcommand: ${sub} — try: (no arg)/deck, web, list, revoke <id>`);
}
