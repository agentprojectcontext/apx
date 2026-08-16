// apx identity — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdIdentity } from "../commands/identity.js";

export default async function route(rest, { parseArgs }) {
  await cmdIdentity(parseArgs(rest));
}
