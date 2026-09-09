// The sticker lexicon: what each sticker MEANS, learned once and remembered.
//
// A sticker is the one media type where describing it every time is both
// expensive and wrong. Expensive because stickers repeat more than any other
// content on WhatsApp — the same six images carry most of a friendship — and a
// vision call per arrival pays again for an answer that cannot change. Wrong
// because a fresh description drifts: the same picture comes back as "a cartoon
// bear waving" one day and "a brown animal with its paw raised" the next, and
// an agent that reads its own history sees two different stickers.
//
// So: describe a sticker the first time, key the description by its content
// hash, and reuse it forever after. That is what makes a sticker legible at all
// — "[sticker: a cartoon bear waving hello]" is a message; "[sticker]" is not.
//
// The key is `fileSha256`, WhatsApp's own hash of the file bytes. It is stable
// across senders and chats (the same sticker pack sends identical bytes), which
// is exactly the property a lexicon needs and exactly what a per-message id
// lacks.
//
// The owner can overwrite any entry with their own words (`meaning_source:
// "owner"`), and a human meaning is never overwritten by a later automatic
// description — the point of learning is that it accumulates.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { APX_HOME } from "#core/config/paths.js";
import { callEngine } from "#core/engines/index.js";
import { visionBridgeModel } from "#core/agent/vision-bridge.js";
import { logWarn } from "#core/logging.js";

const LEXICON_FILE = () => path.join(APX_HOME, "whatsapp", "stickers.json");
const STICKER_DIR = () => path.join(APX_HOME, "whatsapp", "stickers");

/**
 * A filesystem-safe name for a sticker's key.
 *
 * The key is base64 of WhatsApp's content hash, so it carries "/" and "+" — a
 * path built from it straight would escape the directory on the first slash.
 *
 * NORMALISED first, and that is the whole point. Baileys hands `fileSha256` as
 * a Buffer while the lexicon stores its base64, so `String(key)` gave two
 * different names for one sticker depending on which side called: the file was
 * written under the Buffer's bytes and looked up under the base64, so every
 * sticker saved correctly and then read back as missing. Running the key
 * through stickerKey() here means both sides agree whatever they are handed.
 */
const fileFor = (key) => {
  const norm = stickerKey(key);
  if (!norm) return path.join(STICKER_DIR(), "invalid.webp");
  return path.join(STICKER_DIR(), `${crypto.createHash("sha1").update(norm).digest("hex")}.webp`);
};

/**
 * Keep the bytes, not just the description.
 *
 * Understanding a sticker and being able to SEND one are different features,
 * and the second is most of why stickers matter: they are how people answer
 * without words. The downloaded file lives in the media directory with every
 * other transient attachment, so a copy is kept here — content-addressed, so
 * the same sticker arriving from four people is stored once.
 *
 * Returns the stored path, or null if the copy failed (the lexicon entry is
 * still worth having without it).
 */
export function keepStickerFile(key, sourcePath) {
  try {
    if (!key || !sourcePath || !fs.existsSync(sourcePath)) return null;
    const target = fileFor(key);
    if (fs.existsSync(target)) return target;
    fs.mkdirSync(STICKER_DIR(), { recursive: true, mode: 0o700 });
    fs.copyFileSync(sourcePath, target);
    return target;
  } catch {
    return null;
  }
}

/** The stored file for a learned sticker, or null. */
export function stickerFile(key) {
  const f = fileFor(key);
  return fs.existsSync(f) ? f : null;
}

/**
 * Find a sticker by what it MEANS.
 *
 * The agent has words, not hashes: it wants "the thumbs up one", and the
 * lexicon is the only place that connects those words to bytes. Substring
 * first, then per-word overlap, so "pulgar" finds "un pulgar arriba de dibujo"
 * without needing the phrase back verbatim.
 */
export function findStickerByMeaning(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  // Blocked stickers stay in the lexicon and stay legible — the agent must go on
  // UNDERSTANDING one when it arrives — but they can never be picked to send.
  // The two halves of this feature were always separate; blocking is the owner
  // saying "know what this means, do not put it in my name".
  const all = listStickers().filter((s) => stickerFile(s.key) && !s.blocked);
  const exact = all.find((s) => s.meaning.toLowerCase().includes(q));
  if (exact) return exact;

  const words = q.split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return null;
  let best = null;
  let bestScore = 0;
  for (const s of all) {
    const m = s.meaning.toLowerCase();
    const score = words.filter((w) => m.includes(w)).length;
    // Half the words is the floor: below that it is a coincidence, and sending
    // the wrong sticker to somebody is worse than sending none.
    if (score > bestScore && score >= Math.ceil(words.length / 2)) { best = s; bestScore = score; }
  }
  return best;
}

// A description longer than this is a vision model narrating instead of
// naming. Stickers are one gesture; the label should read like one.
const MEANING_CAP = 160;

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export function readStickerLexicon() {
  try {
    const raw = fs.readFileSync(LEXICON_FILE(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Missing or corrupt: an unreadable lexicon must degrade to "I haven't
    // learned any stickers yet", never to a crashed inbound message.
    return {};
  }
}

function writeStickerLexicon(lex) {
  const file = LEXICON_FILE();
  ensureDir(file);
  // Written 0600: the lexicon records who sends what, which is a social graph.
  fs.writeFileSync(file, JSON.stringify(lex, null, 2), { mode: 0o600 });
}

/** Normalize whatever WhatsApp handed us into a stable lookup key. */
export function stickerKey(sha) {
  if (!sha) return null;
  // Baileys gives a Buffer/Uint8Array; config and tests give a hex/base64
  // string. Both must land on the same key or the lexicon learns twice.
  if (typeof sha === "string") return sha.trim() || null;
  try {
    return Buffer.from(sha).toString("base64");
  } catch {
    return null;
  }
}

/** What we already know about this sticker, or null. */
export function recallSticker(sha, lex = readStickerLexicon()) {
  const key = stickerKey(sha);
  if (!key) return null;
  const entry = lex[key];
  return entry && entry.meaning ? entry : null;
}

/**
 * Record a sticker's meaning.
 *
 * `source` is "owner" when a person wrote it and "vision" when a model did. An
 * owner's words are never overwritten by a model's: the owner correcting a bad
 * description is the whole reason this is editable, and having the next arrival
 * silently undo the correction would make the feature useless.
 */
export function learnSticker(sha, meaning, { source = "vision", from = "" } = {}) {
  const key = stickerKey(sha);
  const text = String(meaning || "").trim().slice(0, MEANING_CAP);
  if (!key || !text) return null;

  const lex = readStickerLexicon();
  const prev = lex[key];
  const now = new Date().toISOString();

  if (prev?.meaning_source === "owner" && source !== "owner") {
    // Still worth counting the sighting — how often a sticker is used is part
    // of what it means — but the words stay the owner's.
    prev.last_seen = now;
    prev.count = (prev.count || 0) + 1;
    writeStickerLexicon(lex);
    return prev;
  }

  const entry = {
    meaning: text,
    meaning_source: source,
    // A block is the owner's decision about the sticker, not a fact about this
    // sighting: re-learning must never quietly unblock one.
    ...(prev?.blocked ? { blocked: true } : {}),
    ...(prev?.has_file ? { has_file: true } : {}),
    first_seen: prev?.first_seen || now,
    last_seen: now,
    count: (prev?.count || 0) + 1,
    // Who we have seen using it. Not an identity claim — just context that
    // makes "she always sends this one" available to the agent later.
    senders: Array.from(new Set([...(prev?.senders || []), from].filter(Boolean))).slice(0, 8),
  };
  lex[key] = entry;
  writeStickerLexicon(lex);
  return entry;
}

/** Count a sighting of a sticker we already know, without touching its words. */
export function touchSticker(sha, { from = "" } = {}) {
  const key = stickerKey(sha);
  if (!key) return null;
  const lex = readStickerLexicon();
  const entry = lex[key];
  if (!entry) return null;
  entry.last_seen = new Date().toISOString();
  entry.count = (entry.count || 0) + 1;
  if (from && !entry.senders?.includes(from)) {
    entry.senders = [...(entry.senders || []), from].slice(0, 8);
  }
  writeStickerLexicon(lex);
  return entry;
}

/** The whole lexicon, newest sightings first — for the settings panel. */
export function listStickers() {
  const lex = readStickerLexicon();
  return Object.entries(lex)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => String(b.last_seen || "").localeCompare(String(a.last_seen || "")));
}

/**
 * Block or unblock a sticker for SENDING.
 *
 * Not a delete, and deliberately not one. A sticker somebody sends you is part
 * of how they talk; forgetting it would make their next message unreadable
 * ("[sticker]" says nothing). Blocking keeps the meaning and removes it from
 * everything that picks one to send.
 */
export function setStickerBlocked(sha, blocked) {
  const key = stickerKey(sha);
  if (!key) return null;
  const lex = readStickerLexicon();
  const entry = lex[key];
  if (!entry) return null;
  if (blocked) entry.blocked = true;
  else delete entry.blocked;
  writeStickerLexicon(lex);
  return { key, ...entry };
}

/**
 * Forget a sticker completely: its meaning and its bytes.
 *
 * Irreversible on purpose — this is the "I never want to see this again" door,
 * and leaving the file behind would mean the next arrival silently re-learns it
 * from the copy we kept. Blocking is the reversible one.
 */
export function deleteSticker(sha) {
  const key = stickerKey(sha);
  if (!key) return false;
  const lex = readStickerLexicon();
  const existed = Object.prototype.hasOwnProperty.call(lex, key);
  const file = fileFor(key);
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* the entry still goes */ }
  if (!existed) return false;
  delete lex[key];
  writeStickerLexicon(lex);
  return true;
}

// ---------------------------------------------------------------------------
// Naming a sticker
// ---------------------------------------------------------------------------

// Deliberately not the vision bridge's prompt. That one is written for photos —
// "who/what, clothing, pose, setting, expression. 3–6 sentences" — and a sticker
// answered that way produces a paragraph about a cartoon bear's outfit, which
// then gets truncated at MEANING_CAP into a sentence fragment. A sticker is one
// gesture; the label should read like one.
const STICKER_SYSTEM =
  "You name WhatsApp stickers for an assistant that cannot see them. Reply with ONE short phrase — " +
  "under 12 words — naming what is drawn and the feeling it sends, the way a person would describe it " +
  "to a friend. No preamble, no 'this sticker shows', no full stop. If it contains text, quote it.";

const MIME = { ".webp": "image/webp", ".png": "image/png", ".gif": "image/gif" };

/**
 * Look at a sticker once and say what it is.
 *
 * Returns null on every failure — no vision model, no key, unreadable file — so
 * the caller falls back to announcing that a sticker arrived. A wrong label is
 * worse than no label: it gets written into the lexicon and reused forever.
 */
export async function describeSticker(localPath, globalConfig) {
  try {
    if (!localPath || !fs.existsSync(localPath)) return null;
    const mime = MIME[path.extname(localPath).toLowerCase()] || "image/jpeg";
    const result = await callEngine({
      modelId: visionBridgeModel(globalConfig),
      system: STICKER_SYSTEM,
      messages: [{
        role: "user",
        content: "Name this sticker.",
        // The bytes, not the path. Passing a path was the bug: the bridge
        // filters on `data && mime` and silently dropped the image, so every
        // sticker came back unnamed and nothing said why.
        images: [{ data: fs.readFileSync(localPath).toString("base64"), mime }],
      }],
      config: globalConfig,
      maxTokens: 60,
    });
    return String(result?.text || "").trim().replace(/\.$/, "") || null;
  } catch (e) {
    // Same rule as the bridge: never fail the turn over a label, never fail it
    // in silence either. A retired vision model is exactly the kind of thing
    // that hides behind a bare `catch {}` for weeks.
    logWarn("whatsapp", `sticker description failed: ${e.message}`);
    return null;
  }
}
