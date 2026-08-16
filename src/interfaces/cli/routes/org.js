// apx org — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdOrgAreaAdd, cmdOrgAreaRm, cmdOrgRoleAdd, cmdOrgRoleRm, cmdOrgShow } from "../commands/org.js";

// Aliases accepted for this command. Declared here, next to the command
// itself — a global alias table would be wrong, since the same word means
// different things under different commands ("rm" is remove under `agent`,
// unset under `project config`, revoke under `pair`).
export const aliases = ["organization"];

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  // `apx org area add ...` / `apx org role rm ...` — the resource verb is
  // the first positional, the action the second.
  if (!sub || sub === "show" || sub === "list") await cmdOrgShow(a);
  else if (sub === "area") {
    const action = rest[1];
    const aa = parseArgs(rest.slice(1)); // keep `area` as _[0] for name parsing
    if (action === "add" || action === "new") await cmdOrgAreaAdd(aa);
    else if (action === "rm" || action === "remove" || action === "delete") await cmdOrgAreaRm(aa);
    else die("usage: apx org area <add|rm> ...");
  } else if (sub === "role") {
    const action = rest[1];
    const ra = parseArgs(rest.slice(1));
    if (action === "add" || action === "new") await cmdOrgRoleAdd(ra);
    else if (action === "rm" || action === "remove" || action === "delete") await cmdOrgRoleRm(ra);
    else die("usage: apx org role <add|rm> ...");
  } else die(`unknown org subcommand: ${sub}\nUsage: apx org <show|area|role> ...`);
}
