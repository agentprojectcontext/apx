// apx memory — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdMemory, cmdMemoryNotebook, cmdMemoryConsolidate, cmdMemoryRevert, cmdMemoryPrune } from "../commands/memory.js";

export default async function route(rest, { parseArgs }) {
  // `apx memory <agent-slug>` is the original form and stays the default, so
  // these four names are reserved. An agent literally called "notebook" would
  // be shadowed; that is a trade worth making for a readable command.
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (sub === "notebook") return cmdMemoryNotebook(a);
  if (sub === "consolidate") return cmdMemoryConsolidate(a);
  if (sub === "revert") return cmdMemoryRevert(a);
  if (sub === "prune") return cmdMemoryPrune(a);
  return cmdMemory(parseArgs(rest));
}
