// Remembers which world-changing tool calls a turn already made.
//
// Weaker models (Gemini especially) re-emit the SAME tool call across
// iterations — send_telegram three times with identical args, spamming the
// user. For tools that mutate something we record the (name + args) signature
// and answer a repeat with a synthetic "already done" instead of running it
// again. Read-only tools are exempt: they are idempotent and are legitimately
// repeated (list_tasks before and after a change).
//
// This is a user-facing protection, and it used to live as two loose locals
// inside runAgent alongside eleven other concerns, keyed off an inline array of
// tool-name literals. The names now come from tools/names.js (see
// SIDE_EFFECT_TOOLS) and the ledger is its own object, so both halves can be
// tested without driving a whole agent turn.
import { SIDE_EFFECT_TOOLS, MESSAGE_TOOLS } from "../tools/names.js";

// ── Near-duplicate messages ────────────────────────────────────────────────
//
// The exact-args ledger below stops a model re-emitting the SAME call. It does
// not stop the thing that actually reaches a person: a model that re-words the
// message each time it repeats itself. On 2026-08-30 one WhatsApp from a
// contact produced three Telegram messages to the owner in a single turn —
// "📲 WhatsApp de Juan Pérez: …", "📱 *Consulta WhatsApp de Juan Pérez*: …",
// "📱 Consulta de WhatsApp de Juan Pérez: …" — same event, same quote, three
// different openers, so three different signatures.
//
// So for tools that put words in front of a person, a repeat is judged on what
// the person would READ. The text is stripped to its words (no case, no
// accents, no emoji, no markdown) and compared as a set: mostly the same words
// to the same destination inside one turn is the model saying it again.
//
// Deliberately narrow. It applies to MESSAGE_TOOLS only, because the cost of
// being wrong is asymmetric per tool: a swallowed second message is a nuisance,
// a swallowed second `create_task` loses work. And it is per TURN — the ledger
// dies with it, so tomorrow's identical message still goes out.

/** Fields whose value is what the recipient reads. */
const TEXT_FIELDS = ["text", "message", "body", "caption"];

/** Share of words two messages must have in common to count as one. 0.7 keeps
 *  "encontré 3 turnos" and "no hay turnos" apart while catching a re-worded
 *  opener over an identical quote. */
const SAME_MESSAGE = 0.7;

/** Below this, a set comparison is noise — "listo" vs "ok" would score 0 and
 *  two identical short lines are already caught by the exact signature. */
const MIN_WORDS = 4;

/** Where it is going. Two messages to different chats are never the same one. */
function destinationOf(args) {
  return `${args?.chat_id ?? ""}|${args?.channel ?? ""}`;
}

/**
 * A send that carries a FILE is exempt, both as a candidate and as a record.
 *
 * The payload is the picture, not the words around it: a routine that posts a
 * summary and then the chart it describes writes nearly the same caption twice,
 * and swallowing the second one drops the image entirely. Judging those by
 * their text would trade a duplicate notification for lost content.
 */
const ATTACHMENT_FIELDS = [
  "photo_base64", "photo_path", "photo_url",
  "document_base64", "document_path", "document_url",
];

function carriesFile(args) {
  return ATTACHMENT_FIELDS.some((f) => typeof args?.[f] === "string" && args[f].trim());
}

/** What a person would read, as a bag of words. */
function wordsOf(args) {
  const raw = TEXT_FIELDS
    .map((f) => (typeof args?.[f] === "string" ? args[f] : ""))
    .join(" ");
  return new Set(
    raw
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")             // acentos: "consultá" = "consulta"
      .replace(/[^\p{Letter}\p{Number}\s]/gu, " ") // emoji, markdown, puntuación
      .split(/\s+/)
      .filter(Boolean),
  );
}

/** Jaccard: shared words over total distinct words. */
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * @returns {{
 *   signature(name: string, args: unknown): string|null,
 *   seen(sig: string|null): boolean,
 *   previous(sig: string): unknown,
 *   nearDuplicate(name: string, args: unknown): unknown|null,
 *   record(sig: string|null, result: unknown, call?: {name: string, args: unknown}): void,
 * }}
 *   `signature` returns null for read-only tools, which callers treat as
 *   "never dedupe this".
 */
export function createSideEffectLedger() {
  const executed = new Map();
  // What has already been said to a person this turn: { destination, words,
  // result }, one per message tool call that actually ran.
  const said = [];

  return {
    signature(name, args) {
      if (!SIDE_EFFECT_TOOLS.has(name)) return null;
      try {
        return `${name}:${JSON.stringify(args)}`;
      } catch {
        // Circular or otherwise unserializable args: fall back to the tool
        // name alone. Deduping slightly too eagerly is safer than sending the
        // same message twice.
        return `${name}:<unserializable>`;
      }
    },
    seen(sig) {
      return sig != null && executed.has(sig);
    },
    previous(sig) {
      return executed.get(sig);
    },
    /**
     * Has something close enough to this message already gone out this turn?
     *
     * @returns the previous result when it has, otherwise null — so a caller
     *          answers the repeat exactly the way it answers an exact one.
     */
    nearDuplicate(name, args) {
      if (!MESSAGE_TOOLS.has(name) || carriesFile(args)) return null;
      const words = wordsOf(args);
      if (words.size < MIN_WORDS) return null;
      const destination = destinationOf(args);
      for (const previous of said) {
        if (previous.destination !== destination) continue;
        if (overlap(words, previous.words) >= SAME_MESSAGE) return previous.result;
      }
      return null;
    },
    record(sig, result, { name, args } = {}) {
      if (sig != null) executed.set(sig, result);
      if (name && MESSAGE_TOOLS.has(name) && !carriesFile(args)) {
        const words = wordsOf(args);
        if (words.size >= MIN_WORDS) said.push({ destination: destinationOf(args), words, result });
      }
    },
  };
}
