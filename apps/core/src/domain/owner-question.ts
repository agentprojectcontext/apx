// What an agent may put in front of the owner as a question: something they can act on, never a stand-in ("x", "tbd")
// nor a note about another message ("disregard", "sent by mistake"). See HISTORY.md#owner-questions.

/** Fewer letters and digits than this (mentions aside) is not a question anyone can answer. */
const MIN_CHARS = 4;

/** Past this many words, "no decision needed" and the like are read as part of the work, not about the message. */
const LONG_WORDS = 30;

/** Whole texts that stand in for a question, compared after normalize(). */
const PLACEHOLDERS = new Set([
  "placeholder",
  "x",
  "xx",
  "xxx",
  "tbd",
  "tbc",
  "todo",
  "to do",
  "fixme",
  "wip",
  "n a",
  "na",
  "none",
  "null",
  "undefined",
  "nil",
  "test",
  "testing",
  "test question",
  "sample question",
  "example question",
  "dummy",
  "dummy question",
  "question",
  "a question",
  "update",
  "status",
  "need update",
  "needs update",
  "update needed",
  "need an update",
  "any update",
  "any updates",
  "ping",
  "hello",
  "hi",
  "hey",
  "ok",
  "okay",
  "asdf",
  "foo",
  "bar",
  "lorem ipsum",
  "pregunta",
  "una pregunta",
  "prueba",
  "pregunta de prueba",
  "pendiente",
  "nada",
  "hola",
  "actualizar",
  "novedades",
  "alguna novedad",
]);

/** A template left unfilled: "<your question here>", "insert question". */
const TEMPLATE =
  /^(insert|enter|add|type|write|your|escrib\w*|tu|su) (the |a |your |la |una |tu )?(question|text|message|pregunta|texto|mensaje)( here| aqui)?$/;

/** A note about another message rather than a question (English and Spanish), compared after normalize(). */
const META = [
  // "Disregard", "ignore my previous question", but not "ignore this warning and deploy?".
  /^(please )?(disregard|ignore)( (this|that|it|the above|(the|my) (last|previous)|previous))?( (message|question|one|request))?( please)?$/,
  /^(please )?(disregard|ignore) (this|that|the above|(the|my) (last|previous)|previous) (message|question|one|request)\b/,
  /^(never ?mind|nvm)\b/,
  /^(por favor )?(ignor(a|alo|en)|olvid(a|alo|en|ate)|descart(a|alo|en))( (esto|eso|lo anterior))?( por favor)?$/,
  /^(ignor|olvid|descart)\w* (mi|la|el|este|esta|ese|esa) ((ultim[oa]|anterior) )?(mensaje|pregunta)\b/,
  /^(no importa|olvidalo|dejalo)( ya\b|$)/,
  /^(perdon|disculp\w*|sorry)( (that|eso))?( (era|fue|was))? (un |an? )?(error|mistake)\b/,
];

/** Phrases that say no answer is wanted, anywhere in the text. */
const META_ANYWHERE =
  /\b(no decision (is )?(requested|needed|required)|no (action|answer|reply|response) (is )?(needed|required|requested)|no need to (answer|reply|respond)|sent (by|in) (mistake|error)|not a (real )?question|(enviad[oa]|mandad[oa]) por error|no (hace falta|es necesario|necesit\w+) (responder|contestar|decidir)|no (se )?requiere (ninguna )?(decision|respuesta|accion)|sin decision (pendiente|requerida)|mensaje de prueba)\b/;

/** Lowercase, accents and punctuation out, mentions out, single spaces. */
function normalize(text: string): string {
  return text
    .replace(/(^|\s)@[\p{L}\p{N}_-]+/gu, " ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Why this text is not a question the owner can act on, or undefined when it is one. The reason is written for the
 * model that wrote the text.
 */
export function ownerQuestionProblem(text: string): string | undefined {
  const words = normalize(text);
  const chars = words.replace(/ /g, "");
  if (chars.length < MIN_CHARS || /^(.)\1*$/.test(chars)) return "it is too short to answer";
  if (PLACEHOLDERS.has(words) || TEMPLATE.test(words)) return "it is a placeholder, not a question";
  // In a longer text such a phrase is more likely about the work than about the message itself.
  const short = words.split(" ").length <= LONG_WORDS;
  if (META.some((re) => re.test(words)) || (short && META_ANYWHERE.test(words)))
    return "it is a note about another message, not a question";
  return undefined;
}
