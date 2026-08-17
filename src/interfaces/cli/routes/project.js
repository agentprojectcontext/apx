// apx project — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdProjectConfigEdit, cmdProjectConfigSet, cmdProjectConfigShow, cmdProjectConfigUnset } from "../commands/project-config.js";
import { cmdProjectAdd, cmdProjectList, cmdProjectRebuild, cmdProjectRemove } from "../commands/project.js";

export default async function route(rest, { parseArgs, die, dispatch }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  const PROJECT_SUBCOMMANDS = new Set([
    "add", "list", "ls", "remove", "rm", "rebuild", "config",
  ]);
  if (sub === "add") await cmdProjectAdd(a);
  else if (sub === "list" || sub === "ls") await cmdProjectList();
  else if (sub === "remove" || sub === "rm") await cmdProjectRemove(a);
  else if (sub === "rebuild") await cmdProjectRebuild(a);
  else if (sub === "config") {
    // apx project config <show|set|unset|edit> <project> ...
    const csub = rest[1];
    const ca = parseArgs(rest.slice(2));
    if (csub === "show" || csub === "get") await cmdProjectConfigShow(ca);
    else if (csub === "set") await cmdProjectConfigSet(ca);
    else if (csub === "unset" || csub === "rm") await cmdProjectConfigUnset(ca);
    else if (csub === "edit") await cmdProjectConfigEdit(ca);
    else die(`unknown project config subcommand: ${csub || "(none)"} — try: show, set, unset, edit`);
  }
  else if (sub && !PROJECT_SUBCOMMANDS.has(sub)) {
    // Sugar: `apx project <name|id> <subcommand...>` runs the inner
    // subcommand with --project=<name|id> appended.
    //   apx project testing mcp list  → apx mcp list --project testing
    //   apx project 2 routine list    → apx routine list --project 2
    const innerCmd = rest[1];
    if (!innerCmd) die(`apx project ${sub}: missing subcommand`);
    const innerRest = [...rest.slice(2), "--project", sub];
    await dispatch(innerCmd, innerRest);
  }
  else die(`unknown project subcommand: ${sub || "(none)"}`);
}
