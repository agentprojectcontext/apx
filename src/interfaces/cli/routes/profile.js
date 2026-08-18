// apx profile — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdProfileConfig, cmdProfileDoctor, cmdProfileInstall, cmdProfileList, cmdProfileOff, cmdProfileShow, cmdProfileSync, cmdProfileUninstall, cmdProfileUse } from "../commands/profile.js";

// Aliases accepted for this command. Declared here, next to the command
// itself — a global alias table would be wrong, since the same word means
// different things under different commands ("rm" is remove under `agent`,
// unset under `project config`, revoke under `pair`).
export const aliases = ["profiles"];

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (!sub || sub === "list" || sub === "ls") await cmdProfileList(a);
  else if (sub === "show" || sub === "get") await cmdProfileShow(a);
  else if (sub === "install" || sub === "add") await cmdProfileInstall(a);
  else if (sub === "use" || sub === "activate") await cmdProfileUse(a);
  else if (sub === "sync") await cmdProfileSync(a);
  else if (sub === "off" || sub === "deactivate") await cmdProfileOff(a);
  else if (sub === "config") await cmdProfileConfig(a);
  else if (sub === "doctor") await cmdProfileDoctor(a);
  else if (sub === "uninstall" || sub === "remove" || sub === "rm") await cmdProfileUninstall(a);
  else die(`unknown profile subcommand: ${sub}\nUsage: apx profile <list|show|install|use|sync|off|config|doctor|uninstall>`);
}
