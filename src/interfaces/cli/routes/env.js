// apx env — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdEnvDetect } from "../commands/runtime.js";

export default async function route(rest, { die }) {
  const sub = rest[0];
  if (sub === "detect" || sub === "list") await cmdEnvDetect();
  else die(`unknown env subcommand: ${sub || "(none)"}`);
}
