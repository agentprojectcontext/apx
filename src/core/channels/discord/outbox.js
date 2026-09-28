// Posting as the bot: split to Discord's limit, send, and write it down.
//
// One path for every message the bot posts — the answer to a call and an
// explicit send the owner asked for (API, CLI, a tool). A send that leaves no
// row in the ledger is a message the room's summary and recall never learn
// about, and the next turn in that room would not know it had said it.
import { CHANNELS } from "#core/constants/channels.js";
import { appendGlobalMessage } from "#core/stores/messages.js";

// Discord's hard limit per message.
export const DISCORD_MAX_CHARS = 2_000;

// Where to cut `s` so the head is at most `lim` characters: a paragraph break,
// then a line break, then a space — each only if it keeps at least half the
// room, so a stray early space cannot produce a three-character message.
function pickCut(s, lim) {
  for (const sep of ["\n\n", "\n", " "]) {
    const at = s.lastIndexOf(sep, lim);
    if (at >= lim * 0.5) return at;
  }
  return lim;
}

/**
 * Split a reply into Discord-sized messages. Nothing is dropped: every
 * character of the input is in exactly one part. A code fence open at a cut is
 * closed at the end of that part and reopened, with its language tag, at the
 * start of the next — room for both is reserved before the cut is chosen.
 */
export function splitForDiscord(text, max = DISCORD_MAX_CHARS) {
  const out = [];
  let rest = String(text || "").trim();
  let reopen = "";
  const CLOSE = "\n```";
  while (rest) {
    if (reopen.length + rest.length <= max) {
      out.push(reopen + rest);
      break;
    }
    const cut = pickCut(rest, max - reopen.length - CLOSE.length);
    const head = reopen + rest.slice(0, cut).trimEnd();
    const fences = head.match(/```[^\n]*/g) || [];
    if (fences.length % 2 === 1) {
      // Odd count: the last fence is an opener still open at the cut.
      out.push(head + CLOSE);
      reopen = `\`\`\`${fences[fences.length - 1].slice(3)}\n`;
      // Inside code, keep indentation: drop only the line break we cut at.
      rest = rest.slice(cut).replace(/^\n+/, "");
    } else {
      out.push(head);
      reopen = "";
      rest = rest.slice(cut).trimStart();
    }
  }
  return out.filter((p) => p.trim());
}

/**
 * Send `text` to a room, in as many messages as it takes, and record each one.
 * Only the first part is threaded as a reply to `replyTo`.
 */
export async function postDiscord({ transport, channelId, text, replyTo = null, room = null, meta = {} }) {
  const parts = splitForDiscord(text);
  if (!parts.length) throw new Error("nothing to send");
  let firstId = null;
  for (const [i, part] of parts.entries()) {
    const sent = await transport.send(channelId, part, { replyTo: i === 0 ? replyTo : null });
    firstId = firstId || sent?.id || null;
    appendGlobalMessage({
      channel: CHANNELS.DISCORD,
      direction: "out",
      type: "agent",
      body: part,
      meta: {
        chat_id: channelId,
        contact_key: channelId,
        message_id: sent?.id || null,
        speaker: "you",
        ...(replyTo ? { in_reply_to: replyTo } : {}),
        ...(room ? { room } : {}),
        ...meta,
      },
    });
  }
  return { parts: parts.length, firstId };
}
