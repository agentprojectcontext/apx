// apx session — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdSessionAsk, cmdSessionCheck, cmdSessionClose, cmdSessionCloseStale, cmdSessionCompact, cmdSessionGet, cmdSessionList, cmdSessionNew, cmdSessionResume, cmdSessionSummary, cmdSessionUpdate } from "../commands/session.js";
import { cmdSessionFind } from "../commands/sessions.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (sub === "new") cmdSessionNew(a);
  else if (sub === "list" || sub === "ls") cmdSessionList(a);
  else if (sub === "get" || sub === "show") cmdSessionGet(a);
  else if (sub === "update") cmdSessionUpdate(a);
  else if (sub === "close") cmdSessionClose(a);
  else if (sub === "check") cmdSessionCheck();
  else if (sub === "close-stale") cmdSessionCloseStale();
  else if (sub === "resume") await cmdSessionResume(a);
  else if (sub === "compact") await cmdSessionCompact(a);
  else if (sub === "find" || sub === "search") cmdSessionFind(a);
  else if (sub === "summary") await cmdSessionSummary(a);
  else if (sub === "ask") await cmdSessionAsk(a);
  else die(`unknown session subcommand: ${sub || "(none)"}`);
}
