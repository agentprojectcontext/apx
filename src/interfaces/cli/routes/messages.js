// apx messages — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdMessagesChat, cmdMessagesSearch, cmdMessagesTail } from "../commands/messages.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (sub === "tail") await cmdMessagesTail(a);
  else if (sub === "chat") await cmdMessagesChat(a);
  else if (sub === "search") await cmdMessagesSearch(a);
  else die(`unknown messages subcommand: ${sub || "(none)"}`);
}
