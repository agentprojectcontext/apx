// Posting as the bot: split to Discord's limit, send, and write it down.
//
// One path for every message the bot posts — the answer to a call and an
// explicit send the owner asked for (API, CLI, a tool). A send that leaves no
// row in the ledger is a message the room's summary and recall never learn
// about, and the next turn in that room would not know it had said it.
import { CHANNELS } from "#core/constants/channels.js";
import { appendGlobalMessage } from "#core/stores/messages.js";
import { maskSecretValues } from "#core/config/secret-values.js";

// A path on THIS machine: a home directory, a mounted volume, a temp dir. None
// of it means anything to a stranger, and all of it says who and where the
// owner is.
const LOCAL_PATH_RE = /(?:\/(?:Users|home|Volumes|private|var\/folders)\/[^\s`'")\]]+)|(?:[A-Z]:\\Users\\[^\s`'")\]]+)/g;

/**
 * The last check before anything is posted to a public room. Code, not prompt:
 * it holds when the model forgets its instructions or is talked out of them.
 *
 *   - any registered secret (config credentials, MCP tokens) is masked;
 *   - local filesystem paths are replaced;
 *   - @everyone / @here are defused (mentions are also off at the API level —
 *     this keeps the text itself from reading as a ping).
 *
 * Returns the text to post and what was changed, for the log.
 */
export function guardDiscordReply(text) {
  const changed = [];
  let out = String(text || "");
  const masked = maskSecretValues(out);
  if (masked !== out) { changed.push("secret"); out = masked; }
  const noPaths = out.replace(LOCAL_PATH_RE, "[local path]");
  if (noPaths !== out) { changed.push("local path"); out = noPaths; }
  const noPings = out.replace(/@(everyone|here)\b/g, "@\u200b$1");
  if (noPings !== out) { changed.push("mass mention"); out = noPings; }
  return { text: out, changed };
}

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
export async function postDiscord({ transport, channelId, text, replyTo = null, room = null, meta = {}, log = () => {} }) {
  const guarded = guardDiscordReply(text);
  if (guarded.changed.length) log(`discord: reply to ${room ? `#${room}` : channelId} guarded (${guarded.changed.join(", ")})`);
  const parts = splitForDiscord(guarded.text);
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
