// Is this text a question somebody can actually answer?
//
// A decision card blocks the task on its decider and, for the owner, sends a
// remote notice. A model that fills `question` with a placeholder, a status
// line or "disregard this card" turns that into a blocker nobody can resolve,
// so the store refuses it before anything is written or sent.

const MIN_MEANINGFUL_CHARS = 8;

const fold = (s) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

// Whole-text placeholders, compared after folding and dropping punctuation.
const PLACEHOLDERS = new Set([
  "placeholder", "placeholder question", "question", "decision", "decision needed", "need decision",
  "needs decision", "need input", "needs input", "needs user input", "need user input", "input needed",
  "need update", "needs update", "update", "update needed", "status", "status update", "pending",
  "tbd", "tbc", "todo", "to do", "n a", "na", "none", "null", "undefined", "test", "testing", "xxx",
  "lorem ipsum", "pregunta", "decision pendiente", "pendiente", "a definir", "por definir", "prueba",
  "nada", "ninguna", "falta definir", "necesito respuesta", "necesito una decision",
]);

// Text about the card itself (taking it back, or explaining the tool) rather
// than a question to the decider.
const META = [
  /^(please\s+)?(disregard|ignore)(\s*([:\-—,.!]|$)|\s+(this|that|it|me|my|the (previous|above|last)|previous|above)\b)/,
  /^(por favor\s+)?(ignor(a|en|ar)|descart(a|en|ar)|olvid(a|en|ar))(\s*([:\-—,.!]|$)|\s+(esto|esta|este|eso|lo anterior|la anterior)\b)/,
  /\bno (decision|question|input|answer|reply) (is |was )?(requested|needed|required|necessary)\b/,
  /\bnothing to decide\b/,
  /\bno (se )?(requiere|necesita|pide|solicita|hace falta)n? (ninguna |una )?(decision|respuesta|pregunta)\b/,
  /\b(no hay|sin) (ninguna )?(decision|pregunta)( (pendiente|que tomar))?\b/,
  /\bnada (que|para) decidir\b/,
  /\bdecision fields?\b|\bcampos? de (la )?decision\b/,
  /\b(accidental(ly)?|mistaken|erroneous)( \w+)? (decision|card|question)\b/,
  /\b(decision|card|question|decision card|tarjeta|pregunta)( \w+){0,3} (by mistake|in error|accidentally|por error|por accidente|sin querer)\b/,
];

// A status line wearing a question's clothes: "Update: tests pass".
const STATUS_PREFIX = /^(status|update|fyi|note|progress|estado|actualizacion|nota|avance)\s*[:\-—]/;

/**
 * Why `question` cannot be a decision, or null when it can.
 * @returns {null | "empty" | "too_short" | "placeholder" | "not_a_question" | "status_update"}
 */
export function decisionQuestionProblem(question) {
  const raw = typeof question === "string" ? question.trim() : "";
  if (!raw) return "empty";
  const text = fold(raw);
  const meaningful = text.match(/[\p{L}\p{N}]/gu)?.length || 0;
  if (meaningful < MIN_MEANINGFUL_CHARS) return "too_short";
  const words = text.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (PLACEHOLDERS.has(words)) return "placeholder";
  if (META.some((re) => re.test(text))) return "not_a_question";
  if (STATUS_PREFIX.test(text)) return "status_update";
  return null;
}

/** Throw a message the asking model can act on when the question is not one. */
export function assertDecisionQuestion(question) {
  const problem = decisionQuestionProblem(question);
  if (!problem) return;
  if (problem === "empty") throw new Error("askDecision: question required");
  throw new Error(
    `not a decision (${problem}): nothing was created and nobody was notified. ` +
    "Ask one concrete question the decider can answer (e.g. \"Ship on Friday, or wait for the audit?\"). " +
    "A status update or a note for another agent is an ordinary comment (text). " +
    "To take back a decision asked by mistake, withdraw it instead of asking a new one.",
  );
}
