// apx daemon — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdDaemonLogs, cmdDaemonReload, cmdDaemonRestart, cmdDaemonStart, cmdDaemonStatus, cmdDaemonStop } from "../commands/daemon.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (sub === "start") await cmdDaemonStart(a);
  else if (sub === "stop") await cmdDaemonStop(a);
  else if (sub === "restart") await cmdDaemonRestart(a);
  else if (sub === "reload") await cmdDaemonReload(a);
  else if (sub === "status") await cmdDaemonStatus(a);
  else if (sub === "logs") cmdDaemonLogs(a);
  else die(`unknown daemon subcommand: ${sub || "(none)"}`);
}
