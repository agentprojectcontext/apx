// Short chat words read without a model call: "pará" while the agent works, and the agent's own "REACT ❤️" answer.
// Whether a message needs an answer at all is the agent's call, in any language (DECISIONS.md#d-204).

/** Lowercase, no accents, a letter repeated in a row kept once ("graciaaas" → "gracias", "okkk" → "ok"). */
function squeeze(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/(\p{L})\1+/gu, "$1");
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

/** One emoji, any of them (a flag, a skin tone, a ZWJ sequence too): what every channel can take as a reaction. */
const isReaction = (s: string): boolean => /^(?:\p{RGI_Emoji}|\p{Extended_Pictographic}\uFE0F?)$/v.test(s);

/** "REACT ❤️" (or "REACT: 👍"): the agent answers the other side's last message with that emoji instead of words. */
export function reactAnswer(text: string): string | undefined {
  const m = /^\W*REACT\W*?:?\s+(\S{1,16})\s*$/iu.exec(text.trim());
  const emoji = m?.[1]?.replace(/[*_`]/g, "");
  return emoji && isReaction(emoji) ? emoji : undefined;
}
