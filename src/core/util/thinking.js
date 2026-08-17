// Thinking-block utilities.
//
// Several modern LLMs (qwen3.x, deepseek-r1, gpt-o*, claude with extended
// thinking) emit reasoning blocks delimited by <think>...</think> or
// <thinking>...</thinking>. APX wants to:
//
//   - Keep the reasoning on terminal/local channels (chat REPL, daemon log)
//     because it's useful for the operator.
//   - Strip it from Telegram and other channels where it's just noise.
//
// `splitThinking(text)` splits an LLM response into:
//   { thinking: string, answer: string }
//
// `stripThinking(text)` is a one-line helper that just returns the answer.
// `formatForChannel(text, channel)` renders for a channel: telegram → answer,
// terminal/log/cli → "<thinking>...</thinking>\n\n<answer>".

const THINK_RE = /<(?:think|thinking)>([\s\S]*?)<\/(?:think|thinking)>/gi;

// Untagged chain-of-thought.
//
// Some models — routed free tiers especially — emit their planning as the
// answer itself, with no tags at all: "We need to produce a response to user
// request: ...". That reached a real user's Telegram as a 668-token English
// wall in place of two sentences of Spanish.
//
// Detection is deliberately narrow. It only fires when the text OPENS with
// first-person-plural planning about producing a response, which is a register
// no genuine reply uses. Anything looser would eat real answers that happen to
// begin with "We need to".
const UNTAGGED_COT_OPENERS = [
  /^we need to (produce|craft|write|generate|compose) (a |an )?(response|reply|answer|message)/i,
  /^(the )?user (is )?(asking|says|wants|requests)\b[\s\S]{0,200}?\bwe (should|need to|must)\b/i,
  /^okay,? (so )?(the )?user\b[\s\S]{0,120}?\bwe (should|need to)\b/i,
  /^interpretation:\s/i,
  /^let'?s (think|analyze|break this down)\b/i,
];

/**
 * True when `text` reads as raw planning rather than a reply.
 * Only ever consulted for the ANSWER half, after tagged blocks are removed.
 */
export function looksLikeUntaggedReasoning(text) {
  const t = String(text || "").trimStart();
  if (t.length < 120) return false; // too short to be a planning dump
  return UNTAGGED_COT_OPENERS.some((re) => re.test(t));
}

export function splitThinking(text) {
  if (!text || typeof text !== "string") return { thinking: "", answer: text || "" };
  const blocks = [];
  let answer = text.replace(THINK_RE, (_, inner) => {
    blocks.push(inner.trim());
    return "";
  });
  // Some models emit reasoning before the closing tag of the doc itself —
  // collapse leading/trailing whitespace so the answer is clean.
  answer = answer.replace(/^[\s\n]+/, "").replace(/[\s\n]+$/, "");
  return { thinking: blocks.join("\n\n"), answer };
}

export function stripThinking(text) {
  return splitThinking(text).answer;
}

/**
 * The answer, with untagged planning treated as thinking too.
 *
 * `stripThinking` only removes TAGGED blocks. A model that dumps its planning
 * with no tags slips straight through, which is how a 668-token English
 * chain-of-thought reached a user's phone instead of two sentences of Spanish.
 *
 * When the remaining answer still reads as raw planning, this returns "" — the
 * caller decides what to do with an empty reply, which is a far better failure
 * than shipping the model's notes to the user. Never guesses at salvaging a
 * partial answer out of it.
 *
 * @returns {{ answer: string, leaked: boolean, thinking: string }}
 */
export function stripReasoning(text) {
  const { thinking, answer } = splitThinking(text);
  if (looksLikeUntaggedReasoning(answer)) {
    return { answer: "", leaked: true, thinking: [thinking, answer].filter(Boolean).join("\n\n") };
  }
  return { answer, leaked: false, thinking };
}

export function formatForChannel(text, channel) {
  const { thinking, answer } = splitThinking(text);
  // Channels where reasoning would be noise to a human operator
  const STRIP_FOR = new Set(["telegram", "slack", "discord", "sms", "email"]);
  if (STRIP_FOR.has(channel)) return answer;
  // Local channels — keep the thinking visible for debugging
  if (!thinking) return answer;
  return `<thinking>\n${thinking}\n</thinking>\n\n${answer}`;
}
