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

/** The agent's words asked something anywhere: a short reply may be its answer. */
export const asksSomething = (text: string): boolean => text.includes("?");
