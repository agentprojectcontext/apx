// One person, two addresses — folding a phone JID and a LID into one thread.
//
// WhatsApp addresses the same human two ways: the phone number
// (`5491155550001@s.whatsapp.net`) and an opaque per-account LID
// (`123456789012345@lid`). Which one arrives depends on the message: a direct
// chat usually carries the number, a group carries the LID, and a contact whose
// account has migrated carries the LID everywhere.
//
// Inbound already copes: `senderAddresses` hands both to
// `registerWhatsAppSender`, which merges the unseen one into the roster row's
// `alts`. Outbound had no such luck. Send to a phone number for someone whose
// roster row is keyed by LID and the ledger opens a SECOND thread for them —
// the messages we sent in one, their replies in the other, and neither
// readable as a conversation. That is exactly what happened the first time the
// outbox started recording: a contact's thread split down the middle.
//
// The mapping is not something to guess or ask the network for. Baileys keeps
// it, both ways, as plain files in the credential folder we own:
//
//   lid-mapping-<number>.json          → "<lid>"
//   lid-mapping-<lid>_reverse.json     → "<number>"
//
// Reading them is reading our own auth store, not reaching into library
// internals — the files ARE the account's address book, and they are already
// on disk before we can send to anybody (WhatsApp fetches the device list
// first). Best-effort throughout: a missing file just means we have not spoken
// to that person yet, which is not an error.
import fs from "node:fs";
import path from "node:path";
import { whatsappAuthDir } from "./session.js";
import { normalizeJid } from "#core/identity/whatsapp.js";

const LID_SUFFIX = "@lid";
const PHONE_SUFFIX = "@s.whatsapp.net";

const localPart = (jid) => String(jid || "").split("@")[0].split(":")[0];

function readMapping(file) {
  try {
    const raw = fs.readFileSync(path.join(whatsappAuthDir(), file), "utf8");
    const val = JSON.parse(raw);
    // Stored as a bare JSON string. Anything else is a format we do not know,
    // and guessing at it is how a wrong thread key gets written.
    return typeof val === "string" && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The OTHER address this person answers to, or null.
 *
 * Give it a phone JID and it returns their LID; give it a LID and it returns
 * their phone JID.
 */
export function otherAddressFor(jid) {
  const norm = normalizeJid(jid);
  if (!norm) return null;
  const id = localPart(norm);
  if (!id) return null;

  if (norm.endsWith(LID_SUFFIX)) {
    const phone = readMapping(`lid-mapping-${id}_reverse.json`);
    return phone ? normalizeJid(`${localPart(phone)}${PHONE_SUFFIX}`) : null;
  }
  if (norm.endsWith(PHONE_SUFFIX)) {
    const lid = readMapping(`lid-mapping-${id}.json`);
    return lid ? normalizeJid(`${localPart(lid)}${LID_SUFFIX}`) : null;
  }
  return null;
}

/**
 * Every address we know for one person: the one we were handed, plus its
 * counterpart when the account has one. Order matters — the caller's own
 * address stays first, so a lookup that finds nothing still falls back to what
 * it asked about.
 */
export function addressesFor(jid) {
  const norm = normalizeJid(jid);
  if (!norm) return [];
  const other = otherAddressFor(norm);
  return other && other !== norm ? [norm, other] : [norm];
}
