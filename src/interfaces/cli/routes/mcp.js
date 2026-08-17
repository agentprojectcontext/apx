// apx mcp — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdMcpAdd, cmdMcpCheck, cmdMcpDisable, cmdMcpEnable, cmdMcpList, cmdMcpLogs, cmdMcpRemove, cmdMcpRun, cmdMcpTools } from "../commands/mcp.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (sub === "list" || sub === "ls") await cmdMcpList(a);
  else if (sub === "add") await cmdMcpAdd(a);
  else if (sub === "remove" || sub === "rm") await cmdMcpRemove(a);
  else if (sub === "enable") await cmdMcpEnable(a);
  else if (sub === "disable") await cmdMcpDisable(a);
  else if (sub === "run") await cmdMcpRun(a);
  else if (sub === "tools") await cmdMcpTools(a);
  else if (sub === "logs") await cmdMcpLogs(a);
  else if (sub === "check") await cmdMcpCheck(a);
  else die(`unknown mcp subcommand: ${sub || "(none)"}`);
}
