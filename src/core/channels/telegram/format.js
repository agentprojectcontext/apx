// Markdown → something Telegram actually renders.
//
// Every outgoing message went out with no parse_mode, so `**bold**` and
// `inline code` — written by the model despite the plain-text prompt, and by
// APX itself around session ids — reached the phone as literal asterisks and
// backticks. This is the one boundary all text passes: the poller's `_send`.
//
// Text with markdown becomes Telegram HTML built from escaped pieces (valid by
// construction). Text without markdown goes out byte-identical. If Telegram
// still refuses the entities, the same message is resent as clean plain text —
// a formatting choice must never cost a delivery.

const PLACEHOLDER = (i) => `\u0000${i}\u0000`;

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/** Does this text carry markdown worth converting? Plain lists alone do not. */
export function hasMarkdown(text) {
  const s = String(text || "");
  return /```[\s\S]*?```/.test(s)
    || /`[^`\n]+`/.test(s)
    || /\*\*[^*\n]+\*\*/.test(s)
    || /__[^_\n]+__/.test(s)
    || /~~[^~\n]+~~/.test(s)
    || /\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)/.test(s)
    || /^#{1,6}\s+\S/m.test(s)
    || /(^|[\s(])\*[^*\s][^*\n]*?[^*\s]\*(?=[\s).,;:!?]|$)/m.test(s);
}

/**
 * Shared walk: protect code first (its content is literal), then apply the
 * inline rules. `mode` "html" emits tags; "plain" emits only the text.
 */
function convert(text, mode) {
  const html = mode === "html";
  const esc = html ? escapeHtml : (s) => s;
  const slots = [];
  const keep = (v) => { slots.push(v); return PLACEHOLDER(slots.length - 1); };

  let s = String(text);
  // Fenced code: content literal, language tag dropped.
  s = s.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_, code) =>
    keep(html ? `<pre>${escapeHtml(code.replace(/\n$/, ""))}</pre>` : code.replace(/\n$/, "")));
  // Inline code.
  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(html ? `<code>${escapeHtml(code)}</code>` : code));
  // Links (http/https only — anything else stays as written).
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) =>
    keep(html ? `<a href="${escapeAttr(url)}">${escapeHtml(label)}</a>` : `${label} (${url})`));

  s = esc(s);
  const wrap = (tag) => (_, inner) => (html ? `<${tag}>${inner}</${tag}>` : inner);
  s = s.replace(/^#{1,6}\s+(.+)$/gm, wrap("b"));
  s = s.replace(/\*\*([^*\n]+)\*\*/g, wrap("b"));
  s = s.replace(/__([^_\n]+)__/g, wrap("b"));
  s = s.replace(/~~([^~\n]+)~~/g, wrap("s"));
  // Single-asterisk emphasis only when it is clearly emphasis — never inside
  // words or ids, and never underscores (snake_case, t_abc123).
  s = s.replace(/(^|[\s(])\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*(?=[\s).,;:!?]|$)/gm, (_, pre, inner) =>
    `${pre}${html ? `<i>${inner}</i>` : inner}`);
  // Bullets: "* " / "- " at line start read better as "• ".
  s = s.replace(/^(\s*)[*-]\s+/gm, "$1• ");

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

/** The message as Telegram should receive it: `{ text, parse_mode? }`. */
export function formatTelegram(text) {
  const raw = String(text ?? "");
  if (!hasMarkdown(raw)) return { text: raw };
  return { text: convert(raw, "html"), parse_mode: "HTML" };
}

/** Markdown removed, nothing else touched — the fallback when HTML is refused. */
export function plainTelegram(text) {
  const raw = String(text ?? "");
  return hasMarkdown(raw) ? convert(raw, "plain") : raw;
}

/** Telegram's refusal of the markup itself, as opposed to any other failure. */
export function isEntityError(e) {
  return /can't parse|parse entities|unsupported start tag|unexpected end tag|entity/i.test(String(e?.message || e));
}

/** Telegram refuses a longer `sendMessage` text (counted after entity parsing). */
export const TELEGRAM_TEXT_MAX = 4096;

// Room kept free in every piece for the fence that closes a code block cut in two.
const FENCE_CLOSE = "\n```";

/** The fence still open at the end of `text` ("```lang"), or null. */
function openFence(text) {
  let open = null;
  for (const m of String(text).matchAll(/```([^\n`]*)/g)) open = open === null ? `\`\`\`${m[1]}` : null;
  return open;
}

/** Where to cut `rest` so the piece fits in `room`: paragraph, then line, then word, then hard. */
function pickCut(rest, room) {
  for (const sep of ["\n\n", "\n", " "]) {
    const at = rest.lastIndexOf(sep, room - 1);
    if (at >= room * 0.3) return { at, skip: sep.length };
  }
  let at = room;
  // Never split a surrogate pair: half an emoji is an invalid message.
  const code = rest.charCodeAt(at - 1);
  if (at > 1 && code >= 0xd800 && code <= 0xdbff) at -= 1;
  return { at, skip: 0 };
}

/**
 * Raw (markdown) text cut into ordered pieces Telegram accepts. The cut is on
 * the source, before formatting: markup only gets shorter once rendered, so a
 * piece that fits here fits there too. A code block cut in two is closed at
 * the end of one piece and reopened at the start of the next, so each renders.
 */
export function splitTelegramText(text, max = TELEGRAM_TEXT_MAX) {
  const s = String(text ?? "");
  if (s.length <= max) return [s];
  const pieces = [];
  let rest = s;
  let reopen = "";
  while (rest.length) {
    if (reopen.length + rest.length <= max) {
      pieces.push(reopen + rest);
      break;
    }
    const room = Math.max(1, max - reopen.length - FENCE_CLOSE.length);
    const { at, skip } = pickCut(rest, room);
    let piece = reopen + rest.slice(0, at);
    rest = rest.slice(at + skip);
    const fence = openFence(piece);
    if (fence) piece += FENCE_CLOSE;
    reopen = fence ? `${fence}\n` : "";
    if (piece.trim()) pieces.push(piece.replace(/\s+$/, ""));
  }
  return pieces;
}

/** One message: formatted, with the plain resend when Telegram refuses the entities. */
async function sendOne(sendMessage, token, chatId, { text, reply_markup, parse_mode }) {
  if (parse_mode) return sendMessage(token, chatId, { text, reply_markup, parse_mode });
  const f = formatTelegram(text);
  if (!f.parse_mode) return sendMessage(token, chatId, { text: f.text, reply_markup });
  try {
    return await sendMessage(token, chatId, { text: f.text, reply_markup, parse_mode: f.parse_mode });
  } catch (e) {
    if (!isEntityError(e)) throw e;
    return sendMessage(token, chatId, { text: plainTelegram(text), reply_markup });
  }
}

/**
 * Send text through `sendMessage`, formatted. A caller that picked its own
 * parse_mode keeps it. On an entity error the plain version is sent instead.
 * Text over Telegram's limit goes out as several messages, in order; the
 * keyboard rides on the last one, and that one's result is returned. A failed
 * piece throws with how many were already delivered (`partsSent`/`partsTotal`).
 */
export async function sendFormatted(sendMessage, token, chatId, { text, reply_markup, parse_mode } = {}) {
  const parts = splitTelegramText(text);
  let last;
  for (let i = 0; i < parts.length; i += 1) {
    const markup = i === parts.length - 1 ? reply_markup : undefined;
    try {
      last = await sendOne(sendMessage, token, chatId, { text: parts[i], reply_markup: markup, parse_mode });
    } catch (e) {
      if (parts.length > 1) {
        e.message = `${e.message} (part ${i + 1} of ${parts.length}, ${i} already sent)`;
        e.partsSent = i;
        e.partsTotal = parts.length;
      }
      throw e;
    }
  }
  return last;
}
