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
  contactKeyFor,
  isIgnorableJid,
} from "#core/identity/whatsapp.js";
import { resolveInboundMedia } from "./media.js";
import { describeSticker } from "./stickers.js";
import { captureRequest } from "./capture.js";
import { resolveCapabilities } from "./config.js";
import { sendWhatsApp, logOutgoingWhatsApp } from "./outbox.js";

// How much of one conversation a sealed turn is allowed to see. Enough to hold
// a thread, not enough to become a dossier.
const CONTACT_HISTORY_TURNS = 12;

// How long a turn may take before we stop waiting for it.
//
// A sealed turn is ONE model call with no tools — if it has not answered in a
// minute and a half it is not going to, and the person on the other end has
// been watching "escribiendo…" the whole time.
const THIRD_PARTY_DEADLINE_MS = 90_000;
// The owner's turn does real work with real tools, so it gets minutes rather
// than seconds — but still a bound. This is the surface where a hang is
// invisible: no spinner, no console, just a chat that stopped answering.
const OWNER_DEADLINE_MS = 6 * 60_000;
// Rounds of tools the owner's turn may take, mirroring Telegram's budget. The
// deadline above is the backstop for a turn that hangs; this is the guardrail
// for one that simply will not stop.
const WHATSAPP_OWNER_ITERS = 18;

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
  // Status stories, Channels and WhatsApp's own service numbers are not people
  // writing, so they are dropped before anything logs or answers — the one
  // deliberate exception to "every message is logged". See isIgnorableJid.
  //
  // Checked HERE and not only at the socket: this function is the channel's
  // entry point, reached by the tests and by anything that replays a message.
  if (isIgnorableJid(chatJid)) return;
  // One sender, possibly two addresses (phone JID and LID) — see
  // senderAddresses. In a group `participant` is the person and `remoteJid` is
  // the group, so using the chat as the identity would give every member the
  // role of whoever the group matched.
  const addresses = senderAddresses(m.key || {});
  const senderJid = addresses[0] || null;
  if (!senderJid || isIgnorableJid(senderJid)) return;

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
  // Which conversation this belongs to. Stamped on every row in and out, so the
  // thread store can split one day file into one thread per person without
  // knowing anything about WhatsApp addressing — and so an alias (a LID in a
  // group, a phone number in a direct chat) folds into the thread it belongs
  // to instead of opening a second one for the same human.
  const contactKey = contactKeyFor(globalConfig, sender);

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
      ...(contactKey ? { contact_key: contactKey } : {}),
      role: sender.role,
      is_group: sender.isGroup,
      policy,
      // FLAT, the way every other channel writes it (telegram's mediaMeta).
      //
      // This used to nest the whole thing under `meta.media`, and mediaFromMeta
      // — the one function that turns a stored row back into an attachment —
      // looks for `local_path`/`file_id` at the top level. So it found nothing,
      // the thread rendered the marker text instead of the file, and a photo
      // arrived in the panel as the sentence "[image attached — saved to
      // /Users/…]". The bytes were always there; nothing could see them.
      //
      // `meta.media` also already means something else: a LIST of attachments
      // (shapeLedgerMessage reads it as `media_list`), so one object sitting
      // there was overloading the key as well as hiding from the reader.
      ...(media.media ? { ...media.media.meta, media_kind: media.media.kind } : {}),
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
  // A turn on this channel gets a DEADLINE, because the alternative is silence
  // and silence is the one outcome this channel is not allowed to produce.
  //
  // Every other surface has someone watching: the web shows a spinner, Telegram
  // has a typing indicator you can see stop. A WhatsApp conversation has none of
  // that — a turn that never returns is indistinguishable from being ignored, on
  // the surface where being ignored is the whole thing we promised not to do.
  // And a turn CAN never return: an await with no timeout under it (a model
  // call, a media upload to a number we have no session with) parks the promise
  // forever, the daemon goes to 0% CPU, and nothing anywhere says a word.
  //
  // The signal is passed INTO the turn rather than raced against it, so the work
  // actually stops instead of continuing unobserved behind a rejected promise.
  const wa = globalConfig?.whatsapp || {};
  const deadlineMs = thirdParty
    ? Number(wa.third_party_deadline_ms) || THIRD_PARTY_DEADLINE_MS
    : Number(wa.turn_deadline_ms) || OWNER_DEADLINE_MS;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("turn deadline")), deadlineMs);
  try {
    turn = thirdParty
      ? await runSealedTurn({ ctx, sender, chatJid, senderJid, body, media, signal: abort.signal })
      : await runOwnerTurn({ ctx, sender, chatJid, body, media, signal: abort.signal });
    reply = turn?.text || "";
    // Aborted mid-flight: whatever came back is a fragment of a turn that was
    // cut, not an answer. Fall through to the never-silent floor.
    if (abort.signal.aborted && !reply.trim()) throw new Error("turn deadline");
  } catch (e) {
    const timedOut = abort.signal.aborted;
    log(`whatsapp turn ${timedOut ? "timed out" : "failed"} for ${senderJid}: ${e.message}`);
    // Never leave someone on read because our side broke. This is the canned
    // floor — the last resort, not the normal path: a model-authored sentence
    // is impossible here precisely because the model is what did not answer.
    //
    // The OWNER gets one too. They are in the conversation like anyone else,
    // and telling them on Telegram while their own WhatsApp stays blank is how
    // a hang reads as the assistant having stopped working at all.
    reply = thirdParty
      ? "Perdón, ahora no puedo contestarte bien. Te respondo en un rato."
      : timedOut
        ? "Se me colgó ese pedido y lo corté para no dejarte esperando. Probá de nuevo o decímelo por Telegram."
        : "";
    await notifyOwner(
      timedOut
        ? `Corté por tiempo el turno de WhatsApp con ${sender.name} (${Math.round(deadlineMs / 1000)}s sin respuesta).`
        : `Se me cayó el turno de WhatsApp con ${sender.name}: ${e.message}`,
      { kind: "whatsapp_error", sender_jid: senderJid }
    );
  } finally {
    clearTimeout(timer);
    await session.setTyping(chatJid, false);
  }

  if (reply && reply.trim()) {
    // Through the shared outbox, like every other send: it writes the ledger
    // row itself and claims the message id so Baileys' echo of it is not filed
    // a second time. This branch used to send and log by hand, which is
    // precisely how the other two send paths came to have no logging at all.
    await sendWhatsApp({
      session,
      globalConfig,
      to: chatJid,
      text: reply,
      meta: {
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
 * A message the OWNER typed on their own phone, mirrored to us.
 *
 * WhatsApp Web is a companion device, so everything the owner writes from the
 * handset arrives here as `fromMe`. It is not a turn and must never start one —
 * answering it would be answering ourselves — but it IS half of a real
 * conversation, and without it the thread in the panel shows only what the
 * other person said. Recorded, and nothing else.
 *
 * Our own sends never reach this function: the socket claims those by id first
 * (see echo.js), so anything arriving here is genuinely the human's.
 */
export async function handleOwnWhatsAppMessage(m, ctx) {
  const { session, globalConfig, log = () => {} } = ctx;
  const chatJid = m.key?.remoteJid || "";
  if (!chatJid || isIgnorableJid(chatJid)) return;

  // Resolved as `owner`, because that is who wrote it: an image the owner sent
  // from their phone should read as a picture in the thread, not as a marker.
  const media = await resolveInboundMedia(m.message || {}, {
    download: (node, kind) => session.download(m, kind),
    describeImage: (p) => describeSticker(p, globalConfig),
    log,
    from: chatJid,
    audience: "owner",
  });
  // A reaction the owner tapped is a mark on something already said. The
  // inbound side does not log those as messages either.
  if (media.kind === "reaction") return;

  const body = [media.text, textOf(m).trim()].filter(Boolean).join(" ").trim();
  if (!body) return;

  logOutgoingWhatsApp({
    globalConfig,
    chatJid,
    body,
    externalId: m.key?.id || undefined,
    meta: {
      // What separates this row from one the agent wrote. The panel needs it to
      // attribute the bubble to the human rather than to the assistant, and a
      // reader scanning the ledger needs it to know nothing was automated here.
      authored_by: "owner",
      ...(media.media ? { ...media.media.meta, media_kind: media.media.kind } : {}),
    },
  });
  log(`whatsapp: owner wrote to ${chatJid} from their phone — logged, no turn`);
}

/**
 * The owner's own turn: this is Roby, on WhatsApp instead of Telegram.
 */
async function runOwnerTurn({ ctx, sender, chatJid, body, media, signal }) {
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
    // The owner's turn has real tools, so it also gets a real budget — the same
    // shape Telegram uses. Without one it fell through to the conversational
    // default, which on a surface nobody is watching means "as many rounds as
    // it likes".
    maxIters: Number(globalConfig?.super_agent?.whatsapp_max_iters) || WHATSAPP_OWNER_ITERS,
    signal,
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
async function runSealedTurn({ ctx, sender, chatJid, senderJid, body, media, signal }) {
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
    signal,
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
