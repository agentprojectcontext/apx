// Going back over the WhatsApp chats and fixing what was written down wrong.
//
// Every other file in this folder handles a message as it arrives, with the
// code that happened to be deployed that minute. This one is for afterwards.
// Three failures put a chat in a state no future message will fix on its own,
// and all three were live on 2026-09-10:
//
//   1. A NAMELESS ROW. A verified business writes; the decoder of the day read
//      only `pushName`, which a business does not send, so the roster row was
//      created with an empty name and every surface fell back to printing the
//      raw address — a thread headed "104900000000000@lid".
//
//   2. A CONVERSATION APX OPENED AND COULD NOT CONTINUE. The owner told the
//      agent to write to a company. The company answered within seconds, from
//      the LID behind the number we had written to, and resolved as a stranger:
//      logged, never answered. `vouchWhatsAppRecipient` now settles this at
//      send time — but only for sends made after it existed. Every earlier one
//      is still sitting there as a guest.
//
//   3. A MESSAGE THAT NEVER MADE IT INTO THE LEDGER. Buttons, a list, a
//      template: shapes the old decoder did not know, written down as the
//      marker "[empty message]". Nobody said that. The bytes were real and the
//      phone still has them.
//
// So this is a repair pass, not a migration: it reads the roster and the ledger,
// works out what is demonstrably missing, and fixes only what it has evidence
// for. Everything it changes is stamped with why, and `dryRun` prints the same
// report without touching anything.
//
// What it will NOT do, because the evidence does not support it:
//   - invent a name (an address is not a name; better an empty field than a
//     wrong one on a row the owner is about to read),
//   - promote anyone the owner has already decided about — only a guest, and
//     only one APX itself wrote to first,
//   - rewrite a row that says something. A repair that edits real words is a
//     repair that can lose them.
import { readConfig, writeConfig } from "#core/config/index.js";
import { CHANNELS } from "#core/constants/channels.js";
import { SENDER_ROLES } from "#core/constants/roles.js";
import { readGlobalMessages, patchGlobalMessage } from "#core/stores/messages.js";
import {
  findWhatsAppContact,
  isGroupJid,
  normalizeJid,
  ownerAddresses,
  vouchWhatsAppRecipient,
} from "#core/identity/whatsapp.js";
import { otherAddressFor } from "./aliases.js";
import { messageText, readInteractive } from "./interactive.js";
import { resolveInboundMedia } from "./media.js";

/**
 * What the dispatch writes when it could not read the message.
 *
 * Matched as a literal because it IS a literal — one marker, written in one
 * place (dispatch.js). A row holding it is a row where the decoder gave up, and
 * that is exactly the set worth asking the phone about again.
 */
const EMPTY_MARKER = "[empty message]";

/** A display name we are not allowed to believe. */
const NOT_A_NAME = new Set(["", "unknown", "null", "undefined"]);

// Asking the phone for a message it does not have costs ~20s of waiting and
// gets nothing. After this many failed attempts on the same row, stop asking on
// ordinary runs — `force` overrides, which is what you want the day the phone
// comes back online.
const MAX_RECOVERY_ATTEMPTS = 3;

const addressesOf = (c) =>
  [c?.jid, ...(Array.isArray(c?.alts) ? c.alts : [])].map(normalizeJid).filter(Boolean);

/**
 * Everything the ledger knows about WhatsApp, in one pass.
 *
 * Reading the ledger a second time per contact is how a repair over a year of
 * chats turns into minutes of file I/O, so every question this module asks —
 * who did we write to, what did they call themselves, which rows are blank — is
 * answered from this one scan.
 */
function scanLedger(limit) {
  const wroteTo = new Set();      // addresses APX has SENT to
  const heard = new Map();        // address → the last name they arrived under
  const blank = [];               // inbound rows whose body says nothing
  const unfetched = [];           // files that arrived and were never downloaded
  // Per conversation, the last thing said in each direction. What makes a chat
  // "left hanging" is not a message but an ORDER: they spoke last, and the turn
  // that should have answered never wrote anything.
  const lastIn = new Map();
  const lastOut = new Map();

  for (const r of readGlobalMessages({ channel: CHANNELS.WHATSAPP, limit }) || []) {
    const jid = normalizeJid(r?.meta?.chat_jid || r?.meta?.sender_jid || r?.actor_id);
    if (!jid) continue;
    const chat = r?.meta?.contact_key || jid;

    if (r.direction === "out") {
      wroteTo.add(jid);
      lastOut.set(chat, r);
      continue;
    }
    lastIn.set(chat, r);

    const name = String(r.author || "").trim();
    if (!NOT_A_NAME.has(name.toLowerCase())) heard.set(jid, name);

    // A file that arrived before documents were handled at all: the row names
    // it ("[document: quote.pdf — not opened]") and there are no bytes behind
    // it. The phone still has the message, and asking again is the same trick
    // that heals an unreadable one — this time the download runs too.
    if (r?.meta?.media_kind === "document" && !r?.meta?.local_path && !r?.meta?.refused && r?.meta?.external_id) {
      unfetched.push(r);
      continue;
    }

    const body = String(r.body || "").trim();
    if (body && body !== EMPTY_MARKER) continue;
    // A reaction and a sticker have empty bodies by design and their meaning is
    // in the meta, not the text. Rows that already carry a decoded menu are
    // whole too — the marker there means the message had a menu AND no words.
    if (r?.meta?.media_kind || r?.meta?.interactive_options || r?.meta?.interactive_selection) continue;
    if (!r?.meta?.external_id) continue;   // nothing to ask the phone about
    blank.push(r);
  }

  // The ones nobody answered. A message we deliberately do NOT answer is not
  // one of them: a stranger is met with silence on purpose (that is the
  // allowlist doing its job), and a reaction is a mark on something already
  // said, never a question. What is left is the real failure — a contact whose
  // message started a turn that never finished. It happens for one reason and
  // it is banal: the daemon was restarted while the model was still thinking,
  // and WhatsApp will not deliver that message twice.
  const unanswered = [];
  for (const [chat, r] of lastIn) {
    const out = lastOut.get(chat);
    if (out && String(out.ts || "") > String(r.ts || "")) continue;
    const policy = r?.meta?.policy;
    if (policy !== "text_only" && policy !== "full") continue;
    if (r?.meta?.media_kind === "reaction") continue;
    unanswered.push({ chat, row: r });
  }

  return { wroteTo, heard, blank, unfetched, unanswered };
}

/**
 * Look over the roster and the chats and say what is wrong with them.
 *
 * Read-only, and the same list `repairWhatsAppChats` acts on — so the preview
 * and the fix can never disagree about what they saw.
 *
 * @returns {{contacts: object[], messages: object[]}} findings, each
 *   `{ kind, jid, name, detail }`.
 */
export function inspectWhatsAppChats({ cfg = readConfig(), limit = 20_000 } = {}) {
  const wa = cfg?.whatsapp || {};
  const contacts = Array.isArray(wa.contacts) ? wa.contacts : [];
  const owners = ownerAddresses(cfg);
  const { wroteTo, heard, blank, unfetched, unanswered } = scanLedger(limit);

  const findings = [];
  const seen = new Map();   // address → the row that claimed it first

  for (const c of contacts) {
    const addrs = addressesOf(c);
    if (!addrs.length) continue;
    const isOwner = addrs.some((a) => owners.includes(a));

    // One person, two rows. WhatsApp addresses somebody by their number in a
    // direct chat and by their LID in a group, and a roster that learned them
    // on different days holds both — each half a conversation, each its own
    // permission.
    for (const a of addrs) {
      const first = seen.get(a);
      if (first && first !== c) {
        findings.push({ kind: "duplicate", jid: c.jid, name: c.name || "", detail: `same person as ${first.jid}` });
        break;
      }
    }
    for (const a of addrs) if (!seen.has(a)) seen.set(a, c);

    // The other address this account answers to, straight out of our own
    // credential store (aliases.js). Without it the next message from their
    // other half opens a second row and a second thread.
    const other = otherAddressFor(c.jid);
    if (other && !addrs.includes(other)) {
      findings.push({ kind: "alias", jid: c.jid, name: c.name || "", suggest: other, detail: `also ${other}` });
    }

    if (NOT_A_NAME.has(String(c.name || "").trim().toLowerCase())) {
      const known = addrs.map((a) => heard.get(a)).find(Boolean);
      findings.push({
        kind: "nameless",
        jid: c.jid,
        name: "",
        detail: known ? `the ledger calls them ${known}` : "no name anywhere yet — ask the phone",
        ...(known ? { suggest: known } : {}),
      });
    }

    // A guest APX itself wrote to. The owner asked for that message; the person
    // it went to is not a stranger, and the allowlist is the only thing that
    // still thinks so.
    if (!isOwner && !isGroupJid(c.jid) && (!c.role || c.role === SENDER_ROLES.GUEST)) {
      if (addrs.some((a) => wroteTo.has(a))) {
        findings.push({
          kind: "unvouched",
          jid: c.jid,
          name: c.name || "",
          detail: "APX wrote to them first, and cannot answer them back",
        });
      }
    }
  }

  const messages = blank.map((r) => ({
    kind: "unreadable",
    jid: normalizeJid(r?.meta?.chat_jid) || "",
    ts: r.ts,
    external_id: r.meta.external_id,
    attempts: Number(r.meta.recover_attempts) || 0,
    // What the row was written under, so a repair writes the marker for the
    // same audience the message was for.
    policy: r.meta.policy || null,
    detail: "arrived as an empty message — the phone may still have it",
  }));

  for (const r of unfetched) {
    messages.push({
      kind: "unfetched",
      jid: normalizeJid(r?.meta?.chat_jid) || "",
      ts: r.ts,
      external_id: r.meta.external_id,
      attempts: Number(r.meta.recover_attempts) || 0,
      policy: r.meta.policy || null,
      detail: `${r.meta.file_name || "a file"} arrived and was never downloaded`,
    });
  }

  // Reported, never answered automatically. Writing to somebody is the one
  // thing this module must not decide on its own: the message is hours old, the
  // reason it was needed may have passed, and an assistant that answers a
  // yesterday's question as if it were live is worse than one that says nothing.
  // The owner (or the agent, told about it) picks it up from here.
  for (const u of unanswered) {
    const row = findWhatsAppContact(cfg, u.chat);
    messages.push({
      kind: "unanswered",
      jid: u.chat,
      name: row?.nickname || row?.name || u.row.author || "",
      ts: u.row.ts,
      text: String(u.row.body || "").slice(0, 160),
      detail: "they wrote and nothing was sent back",
    });
  }

  return { contacts: findings, messages };
}

/**
 * Fix what `inspectWhatsAppChats` found.
 *
 * `session` is optional and only the message half needs it: names and roles are
 * settled from what is already on disk, so a repair with the socket down still
 * does most of its work and says which part it could not do.
 *
 * @param {object}   opts
 * @param {object}   opts.cfg      global config (mutated in step with disk)
 * @param {object}   opts.session  a live WhatsApp session, or null
 * @param {boolean}  opts.dryRun   report only
 * @param {boolean}  opts.force    ask about messages we have already failed on
 * @returns a report: what was fixed, what was left, and why.
 */
export async function repairWhatsAppChats({
  cfg = readConfig(),
  session = null,
  dryRun = false,
  force = false,
  limit = 20_000,
  log = () => {},
} = {}) {
  const found = inspectWhatsAppChats({ cfg, limit });
  const fixed = [];
  const left = [];

  // ---- the roster --------------------------------------------------------
  for (const f of found.contacts) {
    if (f.kind === "duplicate") {
      // Deliberately not merged automatically. Two rows for one person may
      // carry two sets of the owner's own words (bio, rules, facts), and
      // choosing which survives is a decision, not a repair.
      left.push({ ...f, why: "merge the two rows by hand — each may hold notes the other does not" });
      continue;
    }

    if (f.kind === "alias") {
      if (!dryRun) writeRosterRow(cfg, f.jid, (row) => {
        row.alts = [...new Set([...(row.alts || []), f.suggest])];
      });
      fixed.push({ ...f, action: "linked their other address" });
      continue;
    }

    if (f.kind === "nameless") {
      if (f.suggest) {
        if (!dryRun) writeRosterRow(cfg, f.jid, (row) => {
          row.name = f.suggest;
          // Where the name came from, because it did NOT come from the owner:
          // it is what the person called themselves on a message we received.
          row.name_source = "ledger";
        });
        fixed.push({ ...f, action: `named them ${f.suggest}` });
      } else {
        left.push({ ...f, why: "nothing has ever carried a name for them" });
      }
      continue;
    }

    if (f.kind === "unvouched") {
      if (!dryRun) vouchWhatsAppRecipient(cfg, f.jid, { name: f.name });
      fixed.push({ ...f, action: "answerable now, and flagged for review" });
    }
  }

  // ---- the messages ------------------------------------------------------
  const connected = typeof session?.recoverMessage === "function" && session?.status?.().state === "connected";
  for (const m of found.messages) {
    if (m.kind === "unanswered") {
      left.push({ ...m, why: "nobody answered them — send a reply yourself, or ask the agent to" });
      continue;
    }
    if (!connected) {
      left.push({ ...m, why: "whatsapp is not connected — the phone is the only copy" });
      continue;
    }
    if (!force && m.attempts >= MAX_RECOVERY_ATTEMPTS) {
      left.push({ ...m, why: `asked ${m.attempts} times already — run with force to try again` });
      continue;
    }
    if (dryRun) {
      left.push({ ...m, why: "would ask the phone for it again" });
      continue;
    }

    const recovered = await askPhoneAgain({ session, row: m, log });
    if (!recovered) {
      left.push({ ...m, why: "the phone did not send it back (it may be offline)" });
      continue;
    }
    fixed.push({ ...m, action: `recovered: ${recovered.text.slice(0, 60)}` });
    // The message that came back is also the answer to "who IS this". A
    // verified business sends its name on every message and nothing else ever
    // carries it, so a company that was nameless is named here or nowhere.
    if (recovered.name) {
      const row = findWhatsAppContact(cfg, m.jid);
      if (row && NOT_A_NAME.has(String(row.name || "").trim().toLowerCase())) {
        writeRosterRow(cfg, m.jid, (r) => { r.name = recovered.name; r.name_source = "whatsapp"; });
        fixed.push({ kind: "nameless", jid: m.jid, name: "", action: `named them ${recovered.name}` });
      }
    }
  }

  return {
    dry_run: dryRun,
    connected,
    checked: { contacts: (cfg?.whatsapp?.contacts || []).length, messages: found.messages.length },
    fixed,
    left,
  };
}

/**
 * Edit one roster row on disk, by any address it answers to.
 *
 * NOT `upsertWhatsAppContact`: that one clears `pending_review`, on the rule
 * that editing a row is reviewing it. True of a human in the panel; false of an
 * automatic pass, which is precisely a change nobody has looked at yet.
 */
function writeRosterRow(cfg, jid, mutate) {
  const disk = readConfig();
  disk.whatsapp = disk.whatsapp || {};
  if (!Array.isArray(disk.whatsapp.contacts)) disk.whatsapp.contacts = [];
  const row = findWhatsAppContact(disk, jid);
  if (!row) return false;
  mutate(row);
  writeConfig(disk);
  // Same narrow copy-back as the vouch path: assigning the whole `whatsapp`
  // object would drop an owner that is only in memory.
  if (cfg?.whatsapp) cfg.whatsapp.contacts = disk.whatsapp.contacts;
  return true;
}

/**
 * Ask the phone for one message again, and write down what comes back.
 *
 * The row is rewritten in place rather than appended to, because a second row
 * would put the same message in the thread twice — once as the message and once
 * as the hole it left. Provenance goes in the meta: anyone reading this row a
 * month from now can see the words arrived late and how.
 *
 * Returns `{ text, name }` for a message that came back, or null.
 */
async function askPhoneAgain({ session, row, log }) {
  const key = { remoteJid: row.jid, fromMe: false, id: row.external_id };
  let message = null;
  try {
    message = await session.recoverMessage(key);
  } catch (e) {
    log(`whatsapp repair: ${row.external_id} could not be requested: ${e.message}`);
  }

  const attempts = (Number(row.attempts) || 0) + 1;
  if (!message?.message) {
    patchGlobalMessage({
      channel: CHANNELS.WHATSAPP,
      date: row.ts,
      external_id: row.external_id,
      meta: { recover_attempts: attempts, recover_last_try: new Date().toISOString() },
    });
    return null;
  }

  // A file gets its bytes NOW. The row we are repairing was written when
  // documents were not downloaded at all, so the message names a PDF that never
  // existed on this machine; the phone sent the message back with its media
  // keys intact, and resolving it here is what turns the name into the file.
  //
  // The audience is the one the row was written under: a third party's thread
  // must not gain a local path in its text just because the repair ran as the
  // owner.
  let media = { text: "", media: null };
  try {
    media = await resolveInboundMedia(message.message || {}, {
      download: (_node, kind, opts) => session.download(message, kind, opts),
      log,
      audience: row.policy === "text_only" ? "third_party" : "owner",
    });
  } catch (e) {
    log(`whatsapp repair: media for ${row.external_id} could not be resolved: ${e.message}`);
  }

  const typed = String(messageText(message.message) || "").trim();
  const text = [media.text, typed].filter(Boolean).join(" ").trim();
  const interactive = readInteractive(message.message);
  // Nothing readable even now. Some messages genuinely carry no text — a
  // shape we still do not know, or a media message whose bytes are a separate
  // fetch — and writing an empty body over the marker would lose the fact that
  // something arrived at all.
  if (!text) {
    patchGlobalMessage({
      channel: CHANNELS.WHATSAPP,
      date: row.ts,
      external_id: row.external_id,
      meta: { recover_attempts: attempts, recover_last_try: new Date().toISOString(), recovered_unreadable: true },
    });
    return null;
  }

  patchGlobalMessage({
    channel: CHANNELS.WHATSAPP,
    date: row.ts,
    external_id: row.external_id,
    body: text,
    meta: {
      ...(media.media ? { ...media.media.meta, media_kind: media.media.kind } : {}),
      ...(interactive?.options?.length
        ? { interactive_kind: interactive.kind, interactive_options: interactive.options }
        : {}),
      ...(interactive?.selection ? { interactive_selection: interactive.selection } : {}),
      repaired: true,
      repaired_at: new Date().toISOString(),
      // Said in words rather than a code, because the next person to read it
      // will be reading a thread, not this file.
      repaired_from: "the phone sent the message again (placeholder resend)",
      recover_attempts: attempts,
    },
  });
  return { text, name: nameFromMessage(message) };
}

/**
 * The name a recovered message carries, if any.
 *
 * A verified business sends `verifiedBizName` and no `pushName` — the reason
 * companies land on the roster nameless — so a message that comes back is also
 * the answer to "what is this company called".
 */
export function nameFromMessage(message) {
  const name = String(message?.verifiedBizName || message?.pushName || "").trim();
  return NOT_A_NAME.has(name.toLowerCase()) ? "" : name;
}
