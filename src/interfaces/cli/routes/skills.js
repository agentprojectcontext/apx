// apx skills — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdSkillsAdd, cmdSkillsIndex, cmdSkillsInspect, cmdSkillsInspector, cmdSkillsList, cmdSkillsStatus, cmdSkillsSync } from "../commands/skills.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (!sub || sub === "add") await cmdSkillsAdd(a);
  else if (sub === "list" || sub === "ls") await cmdSkillsList(a);
  else if (sub === "status") await cmdSkillsStatus();
  else if (sub === "sync" || sub === "refresh") await cmdSkillsSync(a);
  else if (sub === "index") await cmdSkillsIndex(a);
  else if (sub === "inspect") await cmdSkillsInspect(a);
  else if (sub === "inspector") await cmdSkillsInspector(a);
  else die(`unknown skills subcommand: ${sub}`);
}
