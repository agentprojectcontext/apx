// apx task — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdTaskAdd, cmdTaskDone, cmdTaskDrop, cmdTaskList, cmdTaskPatch, cmdTaskReopen, cmdTaskShow } from "../commands/task.js";

// Aliases accepted for this command. Declared here, next to the command
// itself — a global alias table would be wrong, since the same word means
// different things under different commands ("rm" is remove under `agent`,
// unset under `project config`, revoke under `pair`).
export const aliases = ["tasks"];

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (!sub || sub === "list" || sub === "ls") await cmdTaskList(a);
  else if (sub === "add" || sub === "new" || sub === "create") await cmdTaskAdd(a);
  else if (sub === "show" || sub === "get") await cmdTaskShow(a);
  else if (sub === "done" || sub === "complete") await cmdTaskDone(a);
  else if (sub === "drop" || sub === "archive") await cmdTaskDrop(a);
  else if (sub === "reopen") await cmdTaskReopen(a);
  else if (sub === "patch" || sub === "edit") await cmdTaskPatch(a);
  else die(`unknown task subcommand: ${sub}\nUsage: apx task <list|add|show|done|drop|reopen|patch>`);
}
