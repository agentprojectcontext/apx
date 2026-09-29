// One chat's history, read back off the ledger.
//
// Split out of dispatch.js so a TOOL can read a thread without importing the
// dispatcher: `send_whatsapp` hands the recent turns back when it is called
// from another channel, and importing dispatch.js from a tool closes a cycle
// (dispatch → super-agent → tool registry → this tool → dispatch).
import { readGlobalMessages, rowContact, mediaFromMeta } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import {
  normalizeJid,
  contactAddresses,
  findWhatsAppContact,
  isGroupJid,
  CONTACT_KEY_OWNER,
} from "#core/identity/whatsapp.js";
import { readConfig } from "#core/config/index.js";

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

const fold = (s) =>
  String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * Who a history request is ABOUT, from whatever the owner called them.
 *
 * "Rodrigo", "+54 9 11 5555-5555", a full JID or `owner` all have to land on the
 * same set of addresses the channel wrote the rows under — a person reaches us
 * as a phone JID in a direct chat and as a LID in a group, and asking for one
 * must return both halves of what they said.
 *
 * Returns `{ target }` or `{ candidates }` when a name matches several people,
 * so the agent asks instead of reading somebody else's conversation.
 */
function resolveHistoryTarget(cfg, contact, rows) {
  const raw = String(contact || "").trim();
  if (fold(raw) === CONTACT_KEY_OWNER) {
    return { target: { name: "owner", key: CONTACT_KEY_OWNER, addresses: [] } };
  }
  const roster = Array.isArray(cfg?.whatsapp?.contacts) ? cfg.whatsapp.contacts : [];
  const asRow = (c) => ({
    name: c.name || c.nickname || null,
    key: normalizeJid(c.jid),
    addresses: contactAddresses(c),
  });

  const asJid = normalizeJid(raw);
  if (asJid) {
    const known = findWhatsAppContact(cfg, asJid);
    if (known) return { target: asRow(known) };
    // Loose digits ("11 5555 5555") name a roster row whose number CONTAINS them.
    const digits = raw.replace(/\D/g, "");
    const partial = roster.filter((c) => contactAddresses(c).some((a) => a.includes(digits)));
    if (partial.length === 1) return { target: asRow(partial[0]) };
    return { target: { name: null, key: asJid, addresses: [asJid] } };
  }

  const q = fold(raw);
  const named = roster.filter((c) => fold(c.name).includes(q) || fold(c.nickname).includes(q));
  if (named.length === 1) return { target: asRow(named[0]) };
  if (named.length > 1) {
    return { candidates: named.map((c) => ({ name: c.name || c.nickname || null, jid: c.jid })) };
  }

  // Not on the roster: somebody who wrote in and was never saved. Their push
  // name is on the rows they sent, and it is all we have to find them by.
  const byAuthor = new Map();
  for (const r of rows) {
    if (r.direction !== "in" || !fold(r.author).includes(q)) continue;
    const key = rowContact(r, CHANNELS.WHATSAPP);
    if (key && key !== CONTACT_KEY_OWNER && !byAuthor.has(key)) byAuthor.set(key, r.author);
  }
  if (byAuthor.size === 1) {
    const [[key, name]] = [...byAuthor];
    return { target: { name, key, addresses: [normalizeJid(key)].filter(Boolean) } };
  }
  if (byAuthor.size > 1) {
    return { candidates: [...byAuthor].map(([jid, name]) => ({ name, jid })) };
  }
  return { target: null };
}

/** Does this row belong to the conversation with `target`? */
function rowIsWith(r, target) {
  if (rowContact(r, CHANNELS.WHATSAPP) === target.key) return true;
  if (target.key === CONTACT_KEY_OWNER) return false;
  const addrs = target.addresses;
  if (!addrs.length) return false;
  // A direct chat is addressed by the person; in a group the chat is the group
  // and the person is the sender — both are "what they said".
  const chat = normalizeJid(r.meta?.chat_jid);
  if (chat && addrs.includes(chat)) return true;
  const sender = normalizeJid(r.meta?.sender_jid);
  return r.direction === "in" && !!sender && addrs.includes(sender);
}

/**
 * The WhatsApp history the OWNER's agent can read: every conversation on the
 * line, or one person's, optionally filtered by text. Read-only.
 *
 * This is what `tail_messages` / `search_messages` with channel `whatsapp`, and
 * `whatsapp_contacts` action `thread`, all call. WhatsApp is a global channel —
 * its rows live in `~/.apx/messages/whatsapp/`, not in any project ledger — and
 * the project-scoped readers those tools used to call never opened that
 * directory: asked "what did Rodrigo say?", the agent searched the right words in
 * the wrong place and honestly reported it could not see the chat.
 *
 * Only `user` and `agent` rows: tool rows are the agent's own plumbing, and the
 * ledger is shown as a conversation.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.contact]  name, nickname, number, JID, or "owner"
 * @param {string}  [opts.query]    case/accent-insensitive substring of the text
 * @param {number}  [opts.limit]    newest n, returned oldest first (default 20, max 200)
 * @param {object}  [opts.cfg]      config (defaults to the one on disk)
 */
export function readWhatsAppHistory({ contact = null, query = null, limit = 20, cfg = null } = {}) {
  const max = Math.max(1, Math.min(Number(limit) || 20, 200));
  let rows = [];
  try {
    rows = readGlobalMessages({ channel: CHANNELS.WHATSAPP, limit: Infinity }) || [];
  } catch {
    rows = [];
  }
  rows = rows.filter((r) => r.type === "user" || r.type === "agent");

  let target = null;
  if (contact && String(contact).trim()) {
    const resolved = resolveHistoryTarget(cfg || readConfig(), contact, rows);
    if (resolved.candidates) {
      return {
        ok: false,
        error: `"${contact}" matches more than one person — ask which one, or pass their jid`,
        candidates: resolved.candidates,
      };
    }
    if (!resolved.target) {
      return { ok: true, contact: null, count: 0, messages: [], note: `no WhatsApp conversation found for "${contact}"` };
    }
    target = resolved.target;
    rows = rows.filter((r) => rowIsWith(r, target));
  }

  const q = query ? fold(query) : "";
  if (q) rows = rows.filter((r) => fold(r.body).includes(q));

  const messages = rows.slice(-max).map((r) => {
    const media = mediaFromMeta(r.meta);
    const chat = r.meta?.chat_jid || null;
    return {
      ts: r.ts,
      direction: r.direction,
      // Who spoke, in words: inbound rows carry the sender's push name; an
      // outbound row was written by this line, whatever agent drafted it.
      from: r.direction === "in" ? r.author || rowContact(r, CHANNELS.WHATSAPP) || "unknown" : "me",
      body: r.body || "",
      ...(chat && isGroupJid(chat) ? { group: chat } : {}),
      ...(media ? { media: { kind: media.kind, name: media.name } } : {}),
    };
  });

  return {
    ok: true,
    contact: target ? { name: target.name, key: target.key } : null,
    count: messages.length,
    total: rows.length,
    messages,
  };
}
