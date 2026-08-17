// apx routine — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdRoutineAdd, cmdRoutineDisable, cmdRoutineEnable, cmdRoutineGet, cmdRoutineHistory, cmdRoutineList, cmdRoutineMemory, cmdRoutineRemove, cmdRoutineRun } from "../commands/routine.js";

// Aliases accepted for this command. Declared here, next to the command
// itself — a global alias table would be wrong, since the same word means
// different things under different commands ("rm" is remove under `agent`,
// unset under `project config`, revoke under `pair`).
export const aliases = ["routines"];

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (sub === "list" || sub === "ls" || sub === undefined) await cmdRoutineList(a);
  else if (sub === "get" || sub === "show") await cmdRoutineGet(a);
  else if (sub === "add" || sub === "new") await cmdRoutineAdd(a);
  else if (sub === "remove" || sub === "rm") await cmdRoutineRemove(a);
  else if (sub === "enable") await cmdRoutineEnable(a);
  else if (sub === "disable") await cmdRoutineDisable(a);
  else if (sub === "run") await cmdRoutineRun(a);
  else if (sub === "history" || sub === "hist") await cmdRoutineHistory(a);
  else if (sub === "memory" || sub === "mem") await cmdRoutineMemory(a);
  else die(`unknown routine subcommand: ${sub}`);
}
