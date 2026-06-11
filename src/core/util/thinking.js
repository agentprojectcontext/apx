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

export function formatForChannel(text, channel) {
  const { thinking, answer } = splitThinking(text);
  // Channels where reasoning would be noise to a human operator
  const STRIP_FOR = new Set(["telegram", "slack", "discord", "sms", "email"]);
  if (STRIP_FOR.has(channel)) return answer;
  // Local channels — keep the thinking visible for debugging
  if (!thinking) return answer;
  return `<thinking>\n${thinking}\n</thinking>\n\n${answer}`;
}
