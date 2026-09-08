// Inbound WhatsApp: who wrote, may we answer, what do we say, and who is told.
//
// The order of operations is the design. Identity and the reply policy are
// settled BEFORE any model sees anything, so "may we speak to this person" is
// never a judgement the model makes about a message that is trying to persuade
// it. By the time a turn runs, the only open question is the wording.
//
// Three outcomes, and two of them are not conversations:
//
//   owner      → the real super-agent turn. Full context, tools, their project.
//   contact    → a sealed turn: third-party prompt, no tools, ONLY this one
//                conversation as history. It cannot reach anything.
//   anyone else→ nothing is sent. The message is logged and the owner is told.
//                Silence is the designed outcome, not a failure.
//
// Two things happen for every non-owner message regardless of the reply:
//   1. it is logged to the `whatsapp` channel (the event log) with the sender's
//      JID as actor, which is also what makes per-contact threads readable;
//   2. the owner is told, by CODE. The turn has no tools, so it could not
//      escalate even if it wanted to — and that is deliberate. A report that
//      depends on the model remembering to report is a report that goes missing
//      exactly when it matters.
import { CHANNELS } from "#core/constants/channels.js";
import { appendGlobalMessage, readGlobalMessages } from "#core/stores/messages.js";
import { runSuperAgent } from "#core/agent/super-agent.js";
import { buildWhatsAppRelationshipBlock } from "./relationship.js";
import { readConfig, writeConfig } from "#core/config/index.js";
import {
  findWhatsAppContact,
  isGroupJid,
  resolveWhatsAppSender,
  registerWhatsAppSender,
  resolveReplyPolicy,
  learnOwnerAliases,
  senderAddresses,
  REPLY_POLICIES,
  normalizeJid,
} from "#core/identity/whatsapp.js";
import { resolveInboundMedia } from "./media.js";
import { describeSticker } from "./stickers.js";
import { captureRequest } from "./capture.js";
import { resolveCapabilities } from "./config.js";

// How much of one conversation a sealed turn is allowed to see. Enough to hold
// a thread, not enough to become a dossier.
const CONTACT_HISTORY_TURNS = 12;

// Coalescing the owner's reports.
//
// The report to the owner is REACTIVE — it fires because somebody wrote — which
// means it does not spend the interruption budget, which means nothing else is
// standing between a sender and the owner's phone. An unknown number sending a
// hundred messages would produce a hundred Telegrams, and a chatty contact is
// only better by degree. The owner asked for the opposite: keep me informed,
// stop writing to me constantly.
//
// So one report per correspondent per window, not per message. The thread is
// already on disk and in the panel; the report exists to make the owner LOOK,
// and the second nudge in five minutes does not make anybody look twice.
const REPORT_WINDOW_MS = {
  // Someone not on the roster. One "this person wrote you" is the whole signal;
  // the rest of their burst says nothing new. Long window, because the decision
  // it prompts (add them or ignore them) is not one you make hourly.
  whatsapp_unknown: 6 * 60 * 60_000,
  // A real conversation with someone the owner vouched for. Short window: it
  // coalesces a burst of four messages into one report without hiding a fresh
  // conversation an hour later.
  whatsapp_relay: 15 * 60_000,
};
// jid|kind → last report. In memory on purpose: a daemon restart SHOULD
// re-announce, because the owner may have missed what was sent before it.
const lastReported = new Map();

function shouldReport(kind, jid) {
  const window = REPORT_WINDOW_MS[kind];
  if (!window) return true;            // errors and anything unlisted: always
  const key = `${jid}|${kind}`;
  const prev = lastReported.get(key) || 0;
  const now = Date.now();
  if (now - prev < window) return false;
  lastReported.set(key, now);
  return true;
}

const textOf = (m) =>
  m.message?.conversation ||
  m.message?.extendedTextMessage?.text ||
  "";

/**
 * @param {object} m    Baileys message
 * @param {object} ctx  { session, globalConfig, projects, plugins, registries,
 *                        log, notifyOwner(text, meta) }
 */
export async function handleWhatsAppMessage(m, ctx) {
  const { session, globalConfig, log = () => {}, notifyOwner = async () => {} } = ctx;

  const chatJid = m.key?.remoteJid || "";
  // One sender, possibly two addresses (phone JID and LID) — see
  // senderAddresses. In a group `participant` is the person and `remoteJid` is
  // the group, so using the chat as the identity would give every member the
  // role of whoever the group matched.
  const addresses = senderAddresses(m.key || {});
  const senderJid = addresses[0] || null;
  if (!senderJid) return;

  registerWhatsAppSender({ cfg: globalConfig, addresses, pushName: m.pushName || "" });
  // A face for the thread. Fetched at most once a day per person and stored on
  // the roster row, because the alternative is a network round-trip on every
  // inbound message for something that changes twice a year.
  void rememberAvatar({ session, cfg: globalConfig, jid: senderJid, chatJid, log });
  const sender = resolveWhatsAppSender({
    cfg: globalConfig,
    addresses,
    chatJid,
    pushName: m.pushName || "",
  });
  // Recognised as the owner through one address? Then the others are theirs
  // too, and remembering that is what makes the NEXT message work when it
  // carries only the one we did not have.
  if (sender.isOwner) learnOwnerAliases(globalConfig, addresses);
  const policy = resolveReplyPolicy(globalConfig, sender);
  const thirdParty = policy === REPLY_POLICIES.TEXT_ONLY;

  // Media resolves before the policy branch so the LOG is complete even for
  // people we never answer: "someone unknown sent a photo" is exactly the kind
  // of thing the owner wants to see.
  const media = await resolveInboundMedia(m.message || {}, {
    download: (node, kind) => session.download(m, kind),
    describeImage: (p) => describeSticker(p, globalConfig),
    log,
    from: senderJid,
    audience: thirdParty ? "third_party" : "owner",
  });

  const typed = textOf(m).trim();
  const body = [media.text, typed].filter(Boolean).join(" ").trim() || "[empty message]";

  // A reaction is a mark on something already said, not something said. It gets
  // logged — the thread should read the way the conversation went — but it does
  // NOT start a turn. Replying to a ❤️ is what a person would never do, and it
  // is also how one tap becomes an LLM call and a message back.
  const isReaction = media.kind === "reaction";

  appendGlobalMessage({
    channel: CHANNELS.WHATSAPP,
    direction: "in",
    type: "user",
    actor_id: senderJid,
    author: sender.name,
    body,
    external_id: m.key?.id || undefined,
    meta: {
      chat_jid: chatJid,
      sender_jid: senderJid,
      role: sender.role,
      is_group: sender.isGroup,
      policy,
      ...(media.media ? { media: media.media } : {}),
    },
  });

  if (isReaction) {
    log(`whatsapp: ${sender.name} ${body} — logged, no reply`);
    return;
  }

  if (policy === REPLY_POLICIES.SILENT) {
    // Not answered, but never invisible. The owner decides whether this person
    // becomes someone we talk to; they can only decide if they are told.
    log(`whatsapp: ${sender.name} <${senderJid}> not on the roster — logged, not answered`);
    if (shouldReport("whatsapp_unknown", senderJid)) {
      await notifyOwner(
        `WhatsApp de ${sender.name} (${shortJid(senderJid)}), que no está en tu lista:\n${clip(body, 300)}`,
        { kind: "whatsapp_unknown", sender_jid: senderJid }
      );
    }
    return;
  }

  await session.markRead(m.key);
  await session.setTyping(chatJid, true);

  let reply = "";
  let turn = null;
  try {
    turn = thirdParty
      ? await runSealedTurn({ ctx, sender, chatJid, senderJid, body, media })
      : await runOwnerTurn({ ctx, sender, chatJid, body, media });
    reply = turn?.text || "";
  } catch (e) {
    log(`whatsapp turn failed for ${senderJid}: ${e.message}`);
    // Never leave someone on read because our side broke. They get a human
    // sentence; the owner gets the actual error.
    reply = thirdParty ? "Perdón, ahora no puedo contestarte bien. Te respondo en un rato." : "";
    await notifyOwner(
      `Se me cayó el turno de WhatsApp con ${sender.name}: ${e.message}`,
      { kind: "whatsapp_error", sender_jid: senderJid }
    );
  } finally {
    await session.setTyping(chatJid, false);
  }

  if (reply && reply.trim()) {
    await session.sendText(chatJid, reply);
    appendGlobalMessage({
      channel: CHANNELS.WHATSAPP,
      direction: "out",
      type: "agent",
      actor_id: senderJid,
      body: reply,
      meta: {
        chat_jid: chatJid,
        sender_jid: senderJid,
        policy,
        // Which model answered and what it cost. The ledger already carried
        // this for every other channel, so a WhatsApp reply rendered without
        // the footer every neighbouring message had — and the panel had no way
        // to tell a sealed turn from the owner's, or to price either.
        ...(turn?.model ? { model: turn.model } : {}),
        ...(turn?.usage ? { usage: turn.usage } : {}),
        ...(thirdParty ? { audience: "third_party" } : {}),
      },
    });
  }

  // Read the same message a second time, on its own, and write down what it was
  // asking for. Runs AFTER the reply so it never delays the person waiting, and
  // beside it rather than inside it so the reply stays plain text with nothing
  // to strip. Only for capabilities the owner turned on for THIS contact.
  let suggestion = null;
  if (thirdParty) {
    try {
      suggestion = await captureRequest({
        body,
        sender,
        chatJid,
        caps: resolveCapabilities(globalConfig, findWhatsAppContact(globalConfig, senderJid)),
        globalConfig,
      });
    } catch (e) {
      log(`whatsapp capture failed: ${e.message}`);
    }
  }

  // The secretary report. Only for people who are not the owner — the owner was
  // in the conversation, telling them about it would be telling them twice.
  //
  // A captured request always reports, even inside the coalescing window: the
  // window exists so chatter does not become notifications, and "she asked for
  // a turn on Thursday" is not chatter.
  if (thirdParty && (suggestion || shouldReport("whatsapp_relay", senderJid))) {
    const askLine = suggestion
      ? `\n\n${suggestion.kind === "appointment" ? "📅 Pide turno" : "📋 Pide"}: ${suggestion.summary}` +
        (suggestion.when_text ? ` — ${suggestion.when_text}` : "") +
        (suggestion.urgent ? " (urgente)" : "") +
        `\nConfirmalo en Settings → WhatsApp → Pendientes.`
      : "";
    await notifyOwner(
      `WhatsApp · ${sender.name}: ${clip(body, 220)}\n→ le contesté: ${clip(reply, 220) || "(nada)"}${askLine}`,
      { kind: "whatsapp_relay", sender_jid: senderJid, suggestion_id: suggestion?.id || null }
    );
  }
}

/**
 * The owner's own turn: this is Roby, on WhatsApp instead of Telegram.
 */
async function runOwnerTurn({ ctx, sender, chatJid, body, media }) {
  const { globalConfig, projects, plugins, registries } = ctx;
  const r = await runSuperAgent({
    globalConfig,
    projects,
    plugins,
    registries,
    prompt: body,
    previousMessages: threadFor(chatJid, { limit: CONTACT_HISTORY_TURNS * 2 }),
    attachments: media.attachment ? [media.attachment] : [],
    channel: CHANNELS.WHATSAPP,
    relationshipBlock: buildWhatsAppRelationshipBlock(sender, globalConfig),
    channelMeta: { chatJid, whatsapp: true },
  });
  return r;
}

/**
 * A sealed turn for someone who is not the owner.
 *
 * Two containments, and they are independent. `audience: "third_party"` decides
 * what the SYSTEM prompt may contain (see buildThirdPartySystem: no memory, no
 * cross-channel threads, no projects, no tools). `previousMessages` decides
 * what the HISTORY may contain, and it is this one conversation and nothing
 * else — a shared history across contacts would hand one person what another
 * said without any prompt ever leaking a thing.
 */
async function runSealedTurn({ ctx, sender, chatJid, senderJid, body, media }) {
  const { globalConfig, projects, plugins, registries } = ctx;
  const r = await runSuperAgent({
    globalConfig,
    projects,
    plugins,
    registries,
    prompt: body,
    previousMessages: threadFor(chatJid, { limit: CONTACT_HISTORY_TURNS, senderJid }),
    attachments: media.attachment ? [media.attachment] : [],
    channel: CHANNELS.WHATSAPP,
    audience: "third_party",
    relationshipBlock: buildWhatsAppRelationshipBlock(sender, globalConfig),
    channelMeta: { chatJid, whatsapp: true },
  });
  return r;
}

/**
 * One conversation, as turns. Filtered by the CHAT, so a group is a thread and
 * a person is a thread, and neither can see the other.
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

/**
 * Keep a contact's profile picture on their roster row.
 *
 * Best-effort in every direction: no picture, a privacy setting, a socket that
 * refuses — all of them leave the row as it was. This never blocks the turn and
 * never throws into it.
 */
async function rememberAvatar({ session, cfg, jid, chatJid, log }) {
  try {
    const contact = findWhatsAppContact(cfg, jid);
    if (!contact) return;
    const today = new Date().toISOString().slice(0, 10);
    if (contact.avatar_checked === today) return;

    const url = await session.profilePicture?.(isGroupJid(chatJid) ? chatJid : jid);
    const disk = readConfig();
    const row = findWhatsAppContact(disk, jid);
    if (!row) return;
    row.avatar_checked = today;
    if (url) row.avatar_url = url;
    else delete row.avatar_url;
    writeConfig(disk);
    cfg.whatsapp = disk.whatsapp;
  } catch (e) {
    log(`whatsapp: avatar lookup failed: ${e.message}`);
  }
}

const clip = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const shortJid = (jid) => String(jid || "").split("@")[0];

/** Test seam: forget the coalescing window. */
export function _resetReportThrottle() {
  lastReported.clear();
}
