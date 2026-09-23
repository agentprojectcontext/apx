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
import { t, resolveLang } from "#core/i18n/index.js";
import { runSuperAgent } from "#core/agent/super-agent.js";
import { resolveTurnSkills } from "#core/agent/skills/turn-skills.js";
import { buildWhatsAppRelationshipBlock } from "./relationship.js";
import { readConfig, writeConfig } from "#core/config/index.js";
import {
  findWhatsAppContact,
  isGroupJid,
  resolveWhatsAppSender,
  registerWhatsAppSender,
  silenceReason,
  resolveReplyPolicy,
  learnOwnerAliases,
  senderAddresses,
  REPLY_POLICIES,
  contactKeyFor,
  isIgnorableJid,
  normalizeJid,
  contactAddresses,
} from "#core/identity/whatsapp.js";
import { resolveInboundMedia } from "./media.js";
import { threadFor } from "./thread.js";
import { messageText, readInteractive } from "./interactive.js";
import { describeSticker } from "./stickers.js";
import { captureRequest } from "./capture.js";
import { DEFAULT_REPLY_DELAY_MS, resolveCapabilities } from "./config.js";
import { sendWhatsApp, logOutgoingWhatsApp } from "./outbox.js";

// How much of one conversation a sealed turn is allowed to see. Enough to hold
// a thread, not enough to become a dossier.
const CONTACT_HISTORY_TURNS = 12;

// There is no deadline on a turn, on purpose.
//
// There used to be one — 90 s for a contact, 6 min for the owner — and on
// 2026-09-23 it was the thing that failed. Every fast model was down (zen will
// not take a turn without tools, Gemini 503, two accounts out of quota), the
// chain fell to a local model that needed longer than 90 s, and the deadline
// cut it and sent the same canned "ahora no puedo contestarte bien" twice, into
// a conversation where the contact had just asked for a logo.
//
// A WhatsApp chat is a chat: bidirectional, at its own pace. Nobody minds a
// reply that takes three minutes; everybody minds a fixed sentence that ignores
// what they asked. The failure a deadline was there to catch — a call that
// never returns — is caught one level down now, by the engine's silence
// timeout (core/engines/index.js), which cuts a provider that stops sending and
// lets the chain move on.
//
// Rounds of tools the owner's turn may take, mirroring Telegram's budget: the
// guardrail for a turn that simply will not stop.
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

// Why nobody answered, in the two places it is said: the daemon log (English,
// like every other line in it) and the owner's own notification (their
// language). Written out rather than composed, because each one is a sentence a
// person reads at a glance on a phone.
const SILENCE_LOG = {
  unknown: "not on the roster",
  muted: "on the roster but muted",
  role_muted: "muted through their role",
  role_undefined: "carries a role with no definition",
  group: "a group, and groups are off",
  auto_reply_off: "auto-reply is off for everyone",
};

const SILENCE_NOTE = {
  unknown: "que no está en tu lista",
  muted: "que tenés en silencio",
  role_muted: "cuyo rol está en silencio",
  role_undefined: "cuyo rol no está definido",
  group: "un grupo, y los grupos están apagados",
  auto_reply_off: "con las respuestas automáticas apagadas",
};

// The last message seen per chat, and the wait that lets a burst finish.
//
// In memory on purpose: it is about the next two seconds, not about history,
// and a restart in the middle of somebody's sentence is not a state worth
// persisting.
const latestPerChat = new Map();

/**
 * Hold for `reply_delay_ms`, and report whether this message is still the one
 * to answer.
 *
 * Returns false when a newer message arrived in the same chat while we waited —
 * the caller returns and the newer turn answers both.
 */
export async function settleDelay({ chatJid, messageId, cfg, sleep = defaultSleep }) {
  const ms = Number(cfg?.whatsapp?.reply_delay_ms);
  const wait = Number.isFinite(ms) ? Math.max(0, Math.min(ms, 30_000)) : DEFAULT_REPLY_DELAY_MS;
  const key = String(chatJid || "");
  const id = String(messageId || "");
  if (!key || !id) return true;              // nothing to compare against
  latestPerChat.set(key, id);
  if (!wait) return true;
  await sleep(wait);
  return latestPerChat.get(key) === id;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tests only: forget what was said in which chat. */
export function _resetSettle() {
  latestPerChat.clear();
}

// ── The turn queue ──────────────────────────────────────────────────────────
//
// `chatJid|senderJid` → the messages parked behind the turn that is running for
// that conversation. Present means "a turn is in flight"; the array is what it
// will answer next. In memory for the same reason the debounce is: it describes
// the next few minutes, and a restart is a new conversation anyway.
const pendingTurns = new Map();

// How many messages may pile up behind one turn, and how many follow-up turns
// one inbound message may cause. Both are floors against a flood, not policy:
// beyond them the messages are still logged and still visible, they simply do
// not each buy a model call.
const MAX_PARKED = 10;
const MAX_FOLLOW_UP_ROUNDS = 5;

/** The attachments of a batch of parked messages, in the order they arrived. */
function mergeMedia(medias) {
  const attachments = [];
  for (const m of medias) {
    if (m?.attachment) attachments.push(m.attachment);
  }
  return { attachments };
}

/** Tests only: forget which conversations have a turn running. */
export function _resetTurnQueue() {
  pendingTurns.clear();
}

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

// What this message SAYS — plain text, or a menu, or the button somebody tapped.
//
// This read `conversation` and `extendedTextMessage.text` and nothing else,
// which is two of the dozen shapes a WhatsApp message can carry. A corporate
// bot answering with three quick-reply buttons matched neither, so the body
// fell through to "[empty message]" and the owner was told a bot had written
// them nothing. See ./interactive.js for the shapes and why there are so many.
const textOf = (m) => messageText(m.message || {});

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

  // What to CALL them.
  //
  // A verified business does not send `pushName` — it sends `verifiedBizName`,
  // which Baileys lifts onto the message. Reading only pushName left every
  // company with an empty name on its roster row, so the panel fell back to
  // printing the raw address: a thread headed "104900000000000@lid" instead of
  // the name on the account. Nothing was broken; nobody had asked for the name.
  const bizName = String(m.verifiedBizName || "").trim();
  const displayName = bizName || m.pushName || "";
  registerWhatsAppSender({
    cfg: globalConfig,
    addresses,
    pushName: displayName,
    business: Boolean(bizName),
  });
  // A face for the thread. Fetched at most once a day per person and stored on
  // the roster row, because the alternative is a network round-trip on every
  // inbound message for something that changes twice a year.
  void rememberAvatar({ session, cfg: globalConfig, jid: senderJid, chatJid, log });
  const sender = resolveWhatsAppSender({
    cfg: globalConfig,
    addresses,
    chatJid,
    pushName: displayName,
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
    download: (node, kind, opts) => session.download(m, kind, opts),
    describeImage: (p) => describeSticker(p, globalConfig),
    log,
    from: senderJid,
    audience: thirdParty ? "third_party" : "owner",
  });

  const typed = textOf(m).trim();
  const body = [media.text, typed].filter(Boolean).join(" ").trim() || "[empty message]";
  // The menu itself, kept on the row rather than only in the rendered text.
  // The turn that ANSWERS a menu is usually not the turn that received it — the
  // owner reads the report on Telegram and says "decile que autos" an hour
  // later — so the options have to outlive this call and a daemon restart. See
  // lastOfferFor() in ./interactive.js, which reads them straight back off here.
  const interactive = readInteractive(m.message || {});

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
      ...(interactive?.options?.length
        ? { interactive_kind: interactive.kind, interactive_options: interactive.options }
        : {}),
      ...(interactive?.selection ? { interactive_selection: interactive.selection } : {}),
    },
  });

  if (isReaction) {
    log(`whatsapp: ${sender.name} ${body} — logged, no reply`);
    return;
  }

  if (policy === REPLY_POLICIES.SILENT) {
    // Not answered, but never invisible. The owner decides whether this person
    // becomes someone we talk to; they can only decide if they are told — and
    // told the TRUTH about why nobody answered. Every silence used to be
    // reported as "no está en tu lista", which sent the owner looking for a
    // missing roster row while the real cause (a mute, two fields away on a row
    // that was there) went unmentioned.
    const reason = silenceReason(globalConfig, sender) || "unknown";
    log(`whatsapp: ${sender.name} <${senderJid}> ${SILENCE_LOG[reason]} — logged, not answered`);
    if (shouldReport("whatsapp_unknown", senderJid)) {
      await notifyOwner(
        `WhatsApp de ${sender.name} (${shortJid(senderJid)}), ${SILENCE_NOTE[reason]}:\n${clip(body, 300)}`,
        { kind: "whatsapp_unknown", sender_jid: senderJid, reason }
      );
    }
    return;
  }

  await session.markRead(m.key);
  await session.setTyping(chatJid, true);

  // Wait before answering — and drop this turn if they are still talking.
  //
  // Two things at once, and the second is the reason it is a debounce rather
  // than a sleep. People write in bursts: "hola", "che", then the actual
  // question. Answering the first one the instant it lands answers a third of a
  // thought, and produces three replies to one message. So the newest message
  // in a chat wins: an earlier turn that is still inside the window stands down
  // and lets the later one answer, which it can, because the thread it reads
  // holds everything that was said in between.
  //
  // The typing indicator is already on above, so the pause reads as thinking.
  if (!(await settleDelay({ chatJid, messageId: m.key?.id, cfg: globalConfig }))) {
    await session.setTyping(chatJid, false);
    log(`whatsapp: ${sender.name} wrote again while we waited — the later message answers both`);
    return;
  }

  // ── One turn at a time per conversation ──────────────────────────────────
  //
  // The debounce above only covers the 2.5s BEFORE a turn starts. The owner's
  // turn may run for six minutes, and anything written inside those minutes
  // used to start a SECOND turn beside the first: two model calls, neither
  // able to see the other's message or the other's reply, both answering.
  //
  // That is what it looked like on 2026-09-16. Manu wrote "desglosalo y
  // mandame el detalle por telegram", then the audio with the four points
  // eight seconds later. Two answers came back: "Ya está, desglosé los cuatro
  // puntos" and, thirteen seconds after it, "¿Qué es lo que querés que
  // desglose? No tengo el contexto inmediato". Both were true about the turn
  // that wrote them, and together they read as an assistant that had lost the
  // plot — which is exactly how it was described: "se le hace un lío".
  //
  // So a turn holds the conversation while it runs, and whatever arrives
  // behind it is parked. When the turn lands, the parked messages get ONE more
  // turn between them, and that turn reads the thread — which by then holds
  // the first reply. Writing while it is thinking is now the ordinary thing it
  // looks like: you say more, and the next answer takes it all in.
  //
  // Keyed by chat AND sender, so serialising never crosses people: in a group
  // two participants still get their own turns, and a sealed turn is never
  // handed somebody else's message.
  await takeTurn({ ctx, sender, policy, thirdParty, chatJid, senderJid }, { body, media });
}

const queueKeyOf = (conv) => `${conv.chatJid}|${conv.senderJid}`;

/**
 * Run a turn for this conversation, or park the message behind the one that is
 * already running. Returns whether an answer went out.
 *
 * `conv` is everything settled before the first turn — who wrote, under which
 * policy, into which chat — and it does not change between rounds. Only the
 * words do.
 */
async function takeTurn(conv, first) {
  const { session, log = () => {} } = conv.ctx;
  const queueKey = queueKeyOf(conv);
  const queued = pendingTurns.get(queueKey);
  if (queued) {
    // Capped: a flood should not become a queue of model calls. The rows are
    // on the ledger either way, so nothing is lost — only un-answered.
    if (!first.followUp && queued.length < MAX_PARKED) queued.push(first);
    log(`whatsapp: ${conv.sender.name} — a turn is already running for this chat; it answers this too`);
    return false;
  }
  pendingTurns.set(queueKey, []);

  let ok = false;
  try {
    await session.setTyping(conv.chatJid, true);
    ok = await answerTurn(conv, first);
    // Drain. Bounded, because a conversation where every answer earns another
    // message is a conversation, not a backlog — after a few rounds the next
    // inbound message starts a turn of its own like any other.
    for (let round = 0; round < MAX_FOLLOW_UP_ROUNDS; round++) {
      const next = pendingTurns.get(queueKey);
      if (!next?.length) break;
      const batch = next.splice(0, next.length);
      await session.setTyping(conv.chatJid, true);
      ok = await answerTurn(conv, {
        body: batch.map((x) => x.body).filter(Boolean).join("\n"),
        media: mergeMedia(batch.map((x) => x.media)),
      });
    }
  } finally {
    pendingTurns.delete(queueKey);
    await session.setTyping(conv.chatJid, false);
  }
  return ok;
}

// ── A reply we owe ──────────────────────────────────────────────────────────
//
// When no model can answer, nothing is sent. The old floor sent a canned
// sentence instead, and it did the opposite of what it promised: it ignored
// the question, it read the same every time (twice in a row on 2026-09-23),
// and it was always in one language whatever the contact spoke.
//
// So a failed turn leaves the conversation OWED a reply, and the reply comes
// later from a model that reads the whole thread — the question that went
// unanswered, anything said since — and is told, as a fact, that its reply
// system failed. What to say about that is its call.
//
// `chatJid|senderJid` → { attempts, timer }. In memory: after a restart the
// next message from that person starts a turn anyway, and `apx whatsapp
// follow-up` picks a conversation up by hand.
const owed = new Map();
// Waits before each automatic retry. After the last one the conversation stays
// owed until the person writes again or the owner asks for a follow-up.
const RETRY_DELAYS_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000];
let retryDelays = RETRY_DELAYS_MS;

/** Tests only: shorter retry waits, and forget every owed reply. */
export function _setRetryDelays(delays) {
  retryDelays = delays || RETRY_DELAYS_MS;
}
export function _resetOwed() {
  for (const d of owed.values()) if (d.timer) clearTimeout(d.timer);
  owed.clear();
}

/** Whether this conversation is waiting on a reply our side failed to give. */
export function isWhatsAppReplyOwed(chatJid, senderJid) {
  return owed.has(`${chatJid}|${senderJid}`);
}

// Written for the MODEL, in English like every other system note. It states
// what happened and what is pending; the words to the person are the model's.
function followUpNote({ debt, manual }) {
  const what = debt
    ? `Your reply system failed on this conversation (${debt.attempts} attempt${debt.attempts === 1 ? "" : "s"}, no model could answer), so the latest messages here have not had a real answer from you.`
    : manual
      ? "The owner asked you to pick this conversation back up. Your reply system may have failed here earlier, leaving messages without a real answer."
      : "";
  if (!what) return "";
  return [
    "# Reply system note",
    what,
    "Any earlier message of yours saying you could not answer right now was an automatic fallback, not something you wrote.",
    "Read the whole conversation and answer what is still pending, in the same thread and tone. If it fits, mention briefly, in your own words and once, that you had a problem with your reply system. Do not repeat anything already said.",
  ].join("\n");
}

function owe(conv, err) {
  const { globalConfig, log = () => {}, notifyOwner = async () => {} } = conv.ctx;
  const key = queueKeyOf(conv);
  const prev = owed.get(key);
  if (prev?.timer) clearTimeout(prev.timer);
  const attempts = (prev?.attempts || 0) + 1;
  const delay = retryDelays[attempts - 1];
  const entry = { attempts, timer: null };
  if (delay != null) {
    entry.timer = setTimeout(() => {
      entry.timer = null;
      retryOwed(conv).catch((e) => log(`whatsapp retry failed for ${conv.senderJid}: ${e.message}`));
    }, delay);
    entry.timer.unref?.();
  }
  owed.set(key, entry);
  log(`whatsapp turn failed for ${conv.senderJid} (attempt ${attempts}): ${err.message}${delay != null ? ` — retrying in ${Math.round(delay / 1000)}s` : " — giving up until they write again"}`);

  // The owner hears about it on the first failure and when the retries run
  // out — not on every attempt in between. A daemon-emitted floor: the model is
  // the thing that is down, so it cannot write this one.
  if (attempts !== 1 && delay != null) return;
  const lang = resolveLang(globalConfig);
  const vars = { name: conv.sender.name, error: clip(err.message, 160), attempts };
  if (delay != null) {
    let at;
    try {
      at = new Date(Date.now() + delay).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
    } catch {
      at = new Date(Date.now() + delay).toISOString().slice(11, 16);
    }
    void notifyOwner(t("whatsapp.reply_failed", { lang, vars: { ...vars, at } }), { kind: "whatsapp_error", sender_jid: conv.senderJid });
  } else {
    void notifyOwner(t("whatsapp.reply_gave_up", { lang, vars }), { kind: "whatsapp_error", sender_jid: conv.senderJid });
  }
}

async function retryOwed(conv) {
  // A turn already running for this chat will answer; it reads the same thread.
  if (pendingTurns.has(queueKeyOf(conv))) return false;
  return takeTurn(conv, { body: unansweredFor(conv), media: null, followUp: true });
}

/** What this person said that has not been answered — or, failing that, the last thing they said. */
function unansweredFor(conv) {
  const turns = threadFor(conv.chatJid, {
    limit: CONTACT_HISTORY_TURNS * 2,
    ...(conv.thirdParty ? { senderJid: conv.senderJid } : {}),
  });
  const pending = [];
  for (let i = turns.length - 1; i >= 0 && turns[i].role === "user"; i--) pending.unshift(turns[i].content);
  if (pending.length) return pending.join("\n");
  return [...turns].reverse().find((x) => x.role === "user")?.content || "";
}

/**
 * Answer once: run the turn, send what it said, and tell the owner about it.
 * Returns whether an answer went out.
 */
async function answerTurn(conv, { body: turnBody, media: turnMedia, followUp = false, manual = false }) {
  const { ctx, sender, policy, thirdParty, chatJid, senderJid } = conv;
  const { session, globalConfig, log = () => {}, notifyOwner = async () => {} } = ctx;
  const key = queueKeyOf(conv);
  const debt = owed.get(key) || null;
  // This turn is the retry now; a second one on a timer would answer twice.
  if (debt?.timer) { clearTimeout(debt.timer); debt.timer = null; }
  const contextNote = followUpNote({ debt, manual: manual || followUp });
  const attachments = turnMedia?.attachment ? [turnMedia.attachment] : (turnMedia?.attachments || []);

  let reply = "";
  let turn = null;
  try {
    turn = thirdParty
      ? await runSealedTurn({ ctx, sender, chatJid, senderJid, body: turnBody, attachments, contextNote })
      : await runOwnerTurn({ ctx, sender, chatJid, body: turnBody, attachments, contextNote });
    reply = turn?.text || "";
    if (!reply.trim()) throw new Error("the turn came back empty");
  } catch (e) {
    owe(conv, e);
    return false;
  }
  owed.delete(key);

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
      ...(followUp || manual ? { follow_up: true } : {}),
    },
  });

  // Read the same message a second time, on its own, and write down what it was
  // asking for. Runs AFTER the reply so it never delays the person waiting, and
  // beside it rather than inside it so the reply stays plain text with nothing
  // to strip. Only for capabilities the owner turned on for THIS contact.
  let suggestion = null;
  if (thirdParty && !followUp && !manual) {
    try {
      suggestion = await captureRequest({
        body: turnBody,
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
  // a turn on Thursday" is not chatter. A reply that settles a debt reports
  // too: the owner was told it failed, and should hear that it was answered.
  if (thirdParty && (suggestion || debt || shouldReport("whatsapp_relay", senderJid))) {
    const askLine = suggestion
      ? `\n\n${suggestion.kind === "appointment" ? "📅 Pide turno" : "📋 Pide"}: ${suggestion.summary}` +
        (suggestion.when_text ? ` — ${suggestion.when_text}` : "") +
        (suggestion.urgent ? " (urgente)" : "") +
        `\nConfirmalo en Settings → WhatsApp → Pendientes.`
      : "";
    await notifyOwner(
      `WhatsApp · ${sender.name}: ${clip(turnBody, 220)}\n→ le contesté: ${clip(reply, 220) || "(nada)"}${askLine}`,
      { kind: "whatsapp_relay", sender_jid: senderJid, suggestion_id: suggestion?.id || null }
    );
  }
  return true;
}

/**
 * Pick a conversation back up by hand: `apx whatsapp follow-up <contact>`.
 *
 * For the reply that is owed after a restart, or any time the owner wants the
 * assistant to take the thread up again. `who` is a JID, a phone number, or a
 * name/nickname off the roster. The turn is the same one an inbound message
 * would get — sealed for a contact, the real one for the owner — reading the
 * thread and told that its reply system may have failed there.
 */
export async function followUpWhatsApp(who, ctx) {
  const { globalConfig } = ctx;
  const contact = findContactLoosely(globalConfig, who);
  const addresses = contact ? contactAddresses(contact) : [normalizeJid(who)].filter(Boolean);
  if (!addresses.length) throw new Error(`no WhatsApp contact matches "${who}"`);

  // Which chat and which address the conversation actually uses: read off the
  // last thing they sent, because a person can reach us from a phone JID and a
  // LID and the reply has to go where they are.
  let last = null;
  try {
    const rows = readGlobalMessages({ channel: CHANNELS.WHATSAPP, limit: 400 }) || [];
    last = [...rows].reverse().find((r) =>
      r.direction === "in" && addresses.includes(normalizeJid(r.meta?.sender_jid)) && !isGroupJid(r.meta?.chat_jid));
  } catch { /* no ledger yet */ }
  if (!last) throw new Error(`there is no conversation with ${contact?.name || who} to pick up`);
  const chatJid = last.meta.chat_jid;
  const senderJid = last.meta.sender_jid;

  const sender = resolveWhatsAppSender({ cfg: globalConfig, addresses, chatJid, pushName: contact?.name || "" });
  const policy = resolveReplyPolicy(globalConfig, sender);
  if (policy === REPLY_POLICIES.SILENT) {
    throw new Error(`${sender.name} is not answered on WhatsApp (${silenceReason(globalConfig, sender) || "silent"})`);
  }
  const conv = { ctx, sender, policy, thirdParty: policy === REPLY_POLICIES.TEXT_ONLY, chatJid, senderJid };
  const busy = pendingTurns.has(queueKeyOf(conv));
  // Resolved now, run by the caller: a turn can take minutes, and whoever asked
  // should hear "picked up" (or why not) before the model is done.
  return {
    name: sender.name,
    chat_jid: chatJid,
    busy,
    run: () => (busy ? Promise.resolve(false) : takeTurn(conv, { body: unansweredFor(conv), media: null, manual: true })),
  };
}

function findContactLoosely(cfg, who) {
  const q = String(who || "").trim();
  if (!q) return null;
  const byJid = findWhatsAppContact(cfg, q);
  if (byJid) return byJid;
  const low = q.toLowerCase();
  const rows = cfg?.whatsapp?.contacts || [];
  const exact = rows.filter((c) => [c.name, c.nickname].some((n) => String(n || "").toLowerCase() === low));
  if (exact.length === 1) return exact[0];
  const partial = rows.filter((c) => [c.name, c.nickname].some((n) => String(n || "").toLowerCase().includes(low)));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`"${who}" matches ${partial.length} contacts — use the JID`);
  return null;
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
    download: (node, kind, opts) => session.download(m, kind, opts),
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
async function runOwnerTurn({ ctx, sender, chatJid, body, attachments = [], contextNote = "" }) {
  const { globalConfig, projects, plugins, registries } = ctx;
  // The per-turn skill decision. This channel never made it, so the owner
  // asking here got a prompt with no matching skill in it while the same
  // question on the web got one — see core/agent/skills/turn-skills.js. Only
  // the owner's turn: a sealed third-party turn has no tools, and a skill it
  // could not act on is just context we owe nobody.
  const skills = await resolveTurnSkills({ prompt: body, globalConfig });
  const r = await runSuperAgent({
    globalConfig,
    projects,
    plugins,
    registries,
    prompt: body,
    ...([contextNote, skills.contextNote].some(Boolean)
      ? { contextNote: [contextNote, skills.contextNote].filter(Boolean).join("\n\n") }
      : {}),
    skipSkillsHint: skills.skipSkillsHint,
    previousMessages: threadFor(chatJid, { limit: CONTACT_HISTORY_TURNS * 2 }),
    attachments,
    channel: CHANNELS.WHATSAPP,
    relationshipBlock: buildWhatsAppRelationshipBlock(sender, globalConfig),
    channelMeta: { chatJid, whatsapp: true },
    // The owner's turn has real tools, so it also gets a real budget — the same
    // shape Telegram uses. Without one it fell through to the conversational
    // default, which on a surface nobody is watching means "as many rounds as
    // it likes".
    maxIters: Number(globalConfig?.super_agent?.whatsapp_max_iters) || WHATSAPP_OWNER_ITERS,
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
async function runSealedTurn({ ctx, sender, chatJid, senderJid, body, attachments = [], contextNote = "" }) {
  const { globalConfig, projects, plugins, registries } = ctx;
  const r = await runSuperAgent({
    globalConfig,
    projects,
    plugins,
    registries,
    prompt: body,
    previousMessages: threadFor(chatJid, { limit: CONTACT_HISTORY_TURNS, senderJid }),
    attachments,
    channel: CHANNELS.WHATSAPP,
    audience: "third_party",
    // The reply-system note, as a CHANNEL note: `contextNote` is owner
    // context and a sealed prompt never carries it.
    ...(contextNote ? { channelNote: contextNote } : {}),
    relationshipBlock: buildWhatsAppRelationshipBlock(sender, globalConfig),
    channelMeta: { chatJid, whatsapp: true },
  });
  return r;
}

/**
 * One conversation, as turns. Filtered by the CHAT, so a group is a thread and
 * a person is a thread, and neither can see the other.
 */

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

// Re-exported for callers that have always imported it from the dispatcher.
export { threadFor };
