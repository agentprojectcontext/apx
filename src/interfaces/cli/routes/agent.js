// apx agent — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdAgentAdd, cmdAgentGet, cmdAgentImport, cmdAgentList, cmdAgentRemove, cmdAgentSet, cmdAgentVaultAdd, cmdAgentVaultList, cmdAgentVaultRestore, cmdAgentVaultRm } from "../commands/agent.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (sub === "add") await cmdAgentAdd(a);
  else if (sub === "set" || sub === "edit" || sub === "update") await cmdAgentSet(a);
  else if (sub === "list" || sub === "ls") cmdAgentList();
  else if (sub === "get" || sub === "show") cmdAgentGet(a);
  else if (sub === "remove" || sub === "rm" || sub === "delete") await cmdAgentRemove(a);
  else if (sub === "import") await cmdAgentImport(a);
  else if (sub === "vault") {
    const vsub = a._[0];
    const va = { ...a, _: a._.slice(1) };
    if (vsub === "list" || vsub === "ls") cmdAgentVaultList(va);
    else if (vsub === "add") await cmdAgentVaultAdd(va);
    else if (vsub === "rm" || vsub === "remove") cmdAgentVaultRm(va);
    else if (vsub === "restore") cmdAgentVaultRestore(va);
    else die(`unknown vault subcommand: ${vsub || "(none)"} — try: list, add, rm, restore`);
  }
  else die(`unknown agent subcommand: ${sub || "(none)"} — try: add, set, list, get, remove, import, vault`);
}
