// apx whatsapp — argument routing.
//
// No aliases: `chats` is `chats` and `repair` is `repair`. One spelling per
// command, so what somebody types is what the docs and the skill say.
import { cmdWhatsAppChats, cmdWhatsAppRepair, cmdWhatsAppStatus } from "../commands/whatsapp.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (sub === "status" || !sub) await cmdWhatsAppStatus();
  else if (sub === "chats") await cmdWhatsAppChats();
  else if (sub === "repair") await cmdWhatsAppRepair(a);
  else die(`unknown whatsapp subcommand: ${sub} — try: status, chats, repair`);
}
