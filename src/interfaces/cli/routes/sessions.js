// apx sessions — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdSessionsList } from "../commands/sessions.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const isListSub = sub === "list" || sub === "ls";
  const a = parseArgs(isListSub ? rest.slice(1) : rest);
  if (!sub || isListSub || sub.startsWith("--")) cmdSessionsList(a);
  else die(`unknown sessions subcommand: ${sub} — try: list`);
}
