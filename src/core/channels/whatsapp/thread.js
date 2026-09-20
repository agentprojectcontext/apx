// One chat's history, read back off the ledger.
//
// Split out of dispatch.js so a TOOL can read a thread without importing the
// dispatcher: `send_whatsapp` hands the recent turns back when it is called
// from another channel, and importing dispatch.js from a tool closes a cycle
// (dispatch → super-agent → tool registry → this tool → dispatch).
import { readGlobalMessages } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import { normalizeJid } from "#core/identity/whatsapp.js";

/**
 * The conversation with one chat, oldest first, as `{role, content}` turns.
 *
 * `senderJid` narrows it further, to one correspondent INSIDE that chat: a
 * sealed turn must not be handed what somebody else said in the same group.
 */
export function threadFor(chatJid, { limit = 12, senderJid = null } = {}) {
  let records = [];
  try {
    records = readGlobalMessages({ channel: CHANNELS.WHATSAPP, limit: 400 }) || [];
  } catch {
    return [];
  }
  const wanted = normalizeJid(chatJid);
  return records
    .filter((r) => {
      const chat = normalizeJid(r.meta?.chat_jid);
      if (!chat || chat !== wanted) return false;
      // Belt and braces for a sealed turn: even inside one chat, only rows that
      // belong to this correspondent count.
      if (senderJid && normalizeJid(r.meta?.sender_jid) !== normalizeJid(senderJid)) return false;
      return r.type === "user" || r.type === "agent";
    })
    .slice(-limit)
    .map((r) => ({ role: r.direction === "in" ? "user" : "assistant", content: r.body || "" }))
    .filter((t) => t.content);
}
