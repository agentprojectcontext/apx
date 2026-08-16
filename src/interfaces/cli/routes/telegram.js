// apx telegram — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdTelegramChannelAdd, cmdTelegramChannelList, cmdTelegramChannelRemove, cmdTelegramChannelSet, cmdTelegramChannelShow, cmdTelegramChannelUnset, cmdTelegramContactRemove, cmdTelegramContacts, cmdTelegramOwner, cmdTelegramRole, cmdTelegramRoles, cmdTelegramSend, cmdTelegramSetup, cmdTelegramStart, cmdTelegramStatus, cmdTelegramStop } from "../commands/telegram.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (sub === "send") await cmdTelegramSend(a);
  else if (sub === "status") await cmdTelegramStatus();
  else if (sub === "start") await cmdTelegramStart();
  else if (sub === "stop") await cmdTelegramStop();
  else if (sub === "setup") cmdTelegramSetup();
  else if (sub === "channel" || sub === "channels") {
    const csub = rest[1];
    const ca = parseArgs(rest.slice(2));
    if (csub === "add") await cmdTelegramChannelAdd(ca);
    else if (csub === "list" || csub === "ls" || !csub) await cmdTelegramChannelList();
    else if (csub === "show" || csub === "get") await cmdTelegramChannelShow(ca);
    else if (csub === "set") await cmdTelegramChannelSet(ca);
    else if (csub === "unset") await cmdTelegramChannelUnset(ca);
    else if (csub === "remove" || csub === "rm") await cmdTelegramChannelRemove(ca);
    else die(`unknown telegram channel subcommand: ${csub} — try: add, list, show, set, unset, remove`);
  }
  else if (sub === "contacts" || sub === "contact") {
    const csub = rest[1];
    const ca = parseArgs(rest.slice(2));
    if (csub === "rm" || csub === "remove") await cmdTelegramContactRemove(ca);
    else if (!csub || csub === "list" || csub === "ls") await cmdTelegramContacts();
    else die(`unknown telegram contacts subcommand: ${csub} — try: list, rm`);
  }
  else if (sub === "role") await cmdTelegramRole(parseArgs(rest.slice(1)));
  else if (sub === "roles") await cmdTelegramRoles(parseArgs(rest.slice(1)));
  else if (sub === "owner") await cmdTelegramOwner(parseArgs(rest.slice(1)));
  else die(`unknown telegram subcommand: ${sub || "(none)"}`);
}
