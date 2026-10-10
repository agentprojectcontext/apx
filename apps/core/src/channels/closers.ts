// A chat message that closes the exchange ("ok", "gracias", "jaja", "👍", "no gastes más tokens") needs no answer:
// spotted here without a model call, so it costs nothing and the chat does not go on forever.

/** Words that, alone or together, only acknowledge or say goodbye (accents and repeated letters already removed). */
const ACK_WORDS = new Set(
  [
    "ok",
    "oka",
    "okey",
    "okay",
    "oki",
    "okis",
    "k",
    "dale",
    "joya",
    "genial",
    "perfecto",
    "perfecta",
    "listo",
    "lista",
    "buenisimo",
    "buenisima",
    "bueno",
    "buena",
    "barbaro",
    "excelente",
    "vale",
    "sale",
    "va",
    "claro",
    "entendido",
    "anotado",
    "gracias",
    "muchas",
    "muchisimas",
    "mil",
    "de",
    "nada",
    "igualmente",
    "besos",
    "beso",
    "abrazo",
    "abrazos",
    "saludos",
    "chau",
    "chao",
    "adios",
    "nos",
    "vemos",
    "hablamos",
    "buenas",
    "noches",
    "genio",
    "genia",
    "capo",
    "capa",
    "crack",
    "thanks",
    "thank",
    "you",
    "thx",
    "ty",
    "great",
    "cool",
    "nice",
    "perfect",
    "got",
    "it",
    "bye",
    "cheers",
  ].map(squeeze),
);

/** Asks outright not to be answered or to stop spending. */
const STOP_PHRASES = [
  /\bno (gastes|gaste|gasten|consumas) (mas )?tokens?\b/,
  /\b(no|sin) (hace falta|es necesario|necesitas?) (que )?(respondas|contestes|responder|contestar)\b/,
  /^no (respondas|contestes)( mas| nada)?$/,
  /\b(stop|don ?t) (wasting|spending) tokens?\b/,
  /\bno (need|reply needed) to (reply|answer)\b/,
];

const LAUGH = /^(ja|je|ji|jo|js|ha|he|hi|lol|lmao|xd)+$/;
const MAX_WORDS = 8;

/** Lowercase, no accents, a letter repeated in a row kept once ("graciaaas" → "gracias", "okkk" → "ok"). */
function squeeze(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/(\p{L})\1+/gu, "$1");
}

/**
 * Whether a chat message needs no answer. `openQuestion`: the agent's last words asked something, so a bare "ok" may
 * be the answer to it; only an outright "do not answer" counts then.
 */
export function needsNoAnswer(text: string, openQuestion: boolean): boolean {
  const flat = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/'/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = flat ? flat.split(" ") : [];
  if (words.length > 16) return false;
  if (words.length && STOP_PHRASES.some((p) => p.test(flat))) return true;
  if (openQuestion) return false;
  // Only emoji (and punctuation): a reaction in words' place.
  if (!words.length) return /\p{Extended_Pictographic}/u.test(text);
  if (words.length > MAX_WORDS) return false;
  return words.every((w) => {
    const s = squeeze(w);
    return ACK_WORDS.has(s) || LAUGH.test(s);
  });
}

/** A short message that only says to stop ("pará", "basta ya", "stop it"), accents and repeated letters removed. */
const STOP_WORK =
  /^(para|pare|paralo|parala|stop|halt|abort|cancel|basta|frena|frenalo|cancela|cancelalo|cancelar|detente|detenete|dejalo|deja eso|olvidalo|no sigas)( (todo|ya|eso|ahi|it|now|por favor|porfa|please))*$/;

/** The owner asks the agent to stop what it is doing (said while a turn runs: it is canceled, not answered). */
export function asksToStop(text: string): boolean {
  const flat = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(squeeze)
    .join(" ");
  return STOP_WORK.test(flat);
}

/** The agent's words asked something anywhere: a short reply may be its answer. */
export const asksSomething = (text: string): boolean => text.includes("?");

const WARM = new Set(
  ["gracias", "muchas", "muchisimas", "thanks", "thank", "thx", "ty", "besos", "beso", "abrazo", "abrazos"].map(
    squeeze,
  ),
);

/**
 * The emoji to answer a closing message with, when the channel reacts instead of keeping silent: warm for thanks,
 * a laugh for a laugh, a thumbs-up otherwise. None for a message that is only emoji (it already is a reaction).
 */
export function reactionFor(text: string): string | undefined {
  const words = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(squeeze);
  if (!words.length) return undefined;
  if (words.some((w) => WARM.has(w))) return "❤️";
  if (words.every((w) => LAUGH.test(w))) return "😂";
  return "👍";
}

/** "REACT ❤️" (or "REACT: 👍"): the agent answers the other side's last message with that emoji instead of words. */
export function reactAnswer(text: string): string | undefined {
  const m = /^\W*REACT\W*?:?\s+(\S{1,16})\s*$/iu.exec(text.trim());
  const emoji = m?.[1]?.replace(/[*_`]/g, "");
  return emoji && /\p{Extended_Pictographic}/u.test(emoji) ? emoji : undefined;
}
