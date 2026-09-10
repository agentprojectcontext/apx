// Every WhatsApp message APX sends leaves through here — and is written down
// here, in the same call.
//
// It used to be three doors. `dispatch.js` answered an inbound message and
// logged its reply; the `send_whatsapp` tool and `POST /api/whatsapp/send`
// reached past it straight into `plugin.send()`. Only the first door wrote to
// the ledger, so a message the agent sent deliberately — the ONE kind somebody
// asked for — was the one kind that left no trace.
//
// That is not a missing feature, it is a trap. On 2026-09-09 a peer agent read
// the whatsapp ledger, correctly saw no outgoing row for a message that had in
// fact been delivered, told the super-agent it had lied about sending it, and
// got a duplicate sent to the same person a minute later. The log was not
// wrong; it simply had no writer on that path. Anything that can send has to
// record, or the record becomes evidence of things that did not happen.
//
// So: one function, one place, send-and-record as a single operation. Callers
// pass what only they know (the model that wrote the reply, the audience of a
// sealed turn); everything about ADDRESSING and THREADING is settled here so a
// row written for the tool is indistinguishable from a row written for a reply.
import { CHANNELS } from "#core/constants/channels.js";
import { appendGlobalMessage } from "#core/stores/messages.js";
import {
  normalizeJid,
  findWhatsAppContact,
  isGroupJid,
  ownerAddresses,
  CONTACT_KEY_OWNER,
} from "#core/identity/whatsapp.js";
import { rememberOwnSend } from "./echo.js";
import { addressesFor } from "./aliases.js";
import { lastOfferFor, matchOption, replyModeFor } from "./interactive.js";

/**
 * Which conversation a message we SENT belongs to.
 *
 * Inbound rows get their `contact_key` from the sender's roster entry (see
 * contactKeyFor). Outbound has no sender to resolve — the correspondent is the
 * chat itself — so the key is the roster jid when we know the person and the
 * chat jid when we do not. Same value either way as the inbound row for the
 * same human, which is the whole point: one thread, not one per direction.
 *
 * A message we send to our OWN number is the owner's thread, matching what
 * contactKeyFor does with `isOwner`.
 */
export function outboundContactKey(cfg, chatJid) {
  const jid = normalizeJid(chatJid);
  if (!jid) return null;
  // BOTH addresses this person answers to — the phone JID and the LID. Which
  // one a send is addressed to is an accident of how the owner typed it, and
  // looking up only that one split a contact's thread in half: our messages
  // filed under the number, their replies under the LID, neither readable as a
  // conversation. See aliases.js.
  const addrs = addressesFor(jid);
  // Every address the owner answers on, learned aliases included — the same
  // list resolveWhatsAppSender consults, so both directions of a conversation
  // with ourselves land on the one `owner` thread.
  const owner = ownerAddresses(cfg);
  if (addrs.some((a) => owner.includes(a))) return CONTACT_KEY_OWNER;
  const contact = findWhatsAppContact(cfg, addrs);
  return normalizeJid(contact?.jid) || jid;
}

/**
 * Write one outgoing WhatsApp row to the ledger.
 *
 * Split out from the send so the echo reader (a message the owner typed on
 * their own phone, which arrives as `fromMe` over the socket) files under the
 * exact same shape as a message we originated ourselves.
 *
 * @param {object}  a
 * @param {object}  a.globalConfig
 * @param {string}  a.chatJid       the conversation
 * @param {string}  a.body          what a person would read
 * @param {string=} a.externalId    the WhatsApp message id, when we have one
 * @param {object=} a.meta          extra meta (model, usage, audience, policy…)
 */
export function logOutgoingWhatsApp({ globalConfig, chatJid, body, externalId, meta = {} }) {
  const jid = normalizeJid(chatJid);
  const contactKey = outboundContactKey(globalConfig, jid);
  return appendGlobalMessage({
    channel: CHANNELS.WHATSAPP,
    direction: "out",
    type: "agent",
    // `actor_id` names the correspondent on this channel, the same way an
    // inbound row does — it is who the conversation is WITH, not who spoke.
    actor_id: jid,
    body,
    ...(externalId ? { external_id: externalId } : {}),
    meta: {
      chat_jid: jid,
      sender_jid: jid,
      ...(contactKey ? { contact_key: contactKey } : {}),
      ...(isGroupJid(jid) ? { is_group: true } : {}),
      ...meta,
    },
  });
}

/**
 * Send a WhatsApp message and record it. The only way out.
 *
 * `kind` picks what leaves: text, a sticker, or a reaction. A reaction is a
 * mark on something already said rather than something said, so it is NOT
 * logged as a message — the same rule the inbound side applies to a reaction it
 * receives. Sending is still done here so no caller has to know that.
 *
 * @param {object}  a
 * @param {object}  a.session       the live session (sendText/sendSticker/sendReaction)
 * @param {object}  a.globalConfig
 * @param {string}  a.to            jid or phone number, in any format
 * @param {string=} a.text          the body, for kind "text" (or the emoji, for "reaction")
 * @param {string=} a.stickerFile   absolute path, for kind "sticker"
 * @param {object=} a.reactTo       the message key being reacted to
 * @param {string=} a.stickerLabel  what the sticker MEANS, for the ledger row
 * @param {object=} a.choice        an option to TAP: { id, title, n, kind } — see chooseWhatsAppOption
 * @param {object=} a.meta          extra meta stamped on the row
 * @returns {Promise<{ ok: true, sent: boolean, to: string, id: string|null }>}
 */
export async function sendWhatsApp({
  session,
  globalConfig,
  to,
  text = "",
  stickerFile = null,
  reactTo = null,
  stickerLabel = "",
  choice = null,
  meta = {},
}) {
  const jid = normalizeJid(to);
  if (!jid) throw new Error(`sendWhatsApp: "${to}" is not a usable phone number or JID`);
  if (!session) throw new Error("whatsapp is not connected");

  if (reactTo) {
    await session.sendReaction(jid, reactTo, text);
    return { ok: true, sent: false, reacted: text || "(removed)", to: jid, id: null };
  }

  if (stickerFile) {
    const res = await session.sendSticker(jid, stickerFile);
    const id = res?.key?.id || null;
    if (id) rememberOwnSend(id);
    // A sticker IS something said, so the thread has to show it. The row
    // carries the meaning rather than the file path: the reader wants to know
    // we sent a thumbs-up, not that a .webp left the disk.
    logOutgoingWhatsApp({
      globalConfig,
      chatJid: jid,
      body: stickerLabel ? `[sticker: ${stickerLabel}]` : "[sticker]",
      externalId: id,
      meta: { ...meta, media_kind: "sticker" },
    });
    return { ok: true, sent: true, sticker: stickerLabel || null, to: jid, id };
  }

  if (choice) {
    // A tap, not a sentence. `native` sends the real reply proto so the bot on
    // the other side sees the button it offered being pressed; `text` types the
    // label instead, for the menu generations Baileys cannot encode a reply for
    // (see replyModeFor). Either way the LEDGER row is the label — a thread
    // that reads "Autos" is the conversation as it happened, and an opaque
    // button id in the transcript is not.
    const label = String(choice.title ?? "").trim() || String(choice.id ?? "").trim();
    const mode = choice.as_text ? "text" : replyModeFor(choice.kind);
    const res = mode === "native"
      ? await session.sendButtonReply(jid, {
          id: choice.id,
          title: label,
          index: Number(choice.n) > 0 ? Number(choice.n) - 1 : 0,
          kind: choice.kind,
        })
      : await session.sendText(jid, label);
    const id = res?.key?.id || null;
    if (id) rememberOwnSend(id);
    logOutgoingWhatsApp({
      globalConfig,
      chatJid: jid,
      body: label,
      externalId: id,
      meta: {
        ...meta,
        interactive_choice: { id: choice.id || null, title: label, kind: choice.kind || null, mode },
      },
    });
    return { ok: true, sent: true, to: jid, id, chose: label, mode };
  }

  const body = String(text ?? "").trim();
  if (!body) throw new Error("sendWhatsApp: refusing to send an empty message");
  const res = await session.sendText(jid, body);
  // Baileys echoes our own sends back through `messages.upsert`. Claim the id
  // BEFORE anything can await, so the echo — which may already be in flight —
  // recognises the message as ours and does not file a second copy.
  const id = res?.key?.id || null;
  if (id) rememberOwnSend(id);
  logOutgoingWhatsApp({ globalConfig, chatJid: jid, body, externalId: id, meta });
  return { ok: true, sent: true, to: jid, id, chars: body.length };
}

/**
 * Answer the last menu somebody sent in this chat.
 *
 * The two halves are deliberately apart: ./interactive.js knows what a menu IS
 * and which option was meant, this file knows how anything leaves and gets
 * written down. All this function does is join them and refuse clearly.
 *
 * A miss RETURNS rather than throws — "there is no menu in that chat" and
 * "nothing matches 'seguros'" are things the agent should say in words, not
 * failures to retry. The available options come back with the refusal so it can
 * say them without a second call.
 *
 * @param {object}  a
 * @param {object}  a.session
 * @param {object}  a.globalConfig
 * @param {string}  a.to        jid or phone number
 * @param {string}  a.option    a number ("2"), an exact title ("Autos") or an id
 * @param {boolean=} a.asText   type the label instead of sending a real tap
 * @param {object=} a.meta
 */
export async function chooseWhatsAppOption({ session, globalConfig, to, option, asText = false, meta = {} }) {
  const jid = normalizeJid(to);
  if (!jid) throw new Error(`chooseWhatsAppOption: "${to}" is not a usable phone number or JID`);
  if (!session) throw new Error("whatsapp is not connected");

  const offer = lastOfferFor(jid);
  if (!offer) {
    return {
      ok: false,
      sent: false,
      error: "no menu was sent in that chat — nothing to choose from. Answer in words instead.",
    };
  }
  const hit = matchOption(offer.options, option);
  if (!hit) {
    return {
      ok: false,
      sent: false,
      error: `"${option}" does not match one option on that menu`,
      available: offer.options.map((o) => `${o.n}. ${o.title}`),
    };
  }
  return sendWhatsApp({
    session,
    globalConfig,
    to: jid,
    choice: { ...hit, kind: offer.kind, as_text: asText },
    meta: { ...meta, ...(offer.message_id ? { in_reply_to: offer.message_id } : {}) },
  });
}
