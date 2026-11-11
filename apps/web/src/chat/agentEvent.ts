import type { Message, Thread } from "@apx/protocol";

export const isIndividualChat = (thread: Thread): boolean =>
  thread.kind === "home" || thread.kind === "agent" || thread.kind === "loose" || thread.kind === "code";

/** A foreign signature is not a new participant in the owner's individual chat. */
export function isAgentEvent(thread: Thread, message: Message): boolean {
  if (!isIndividualChat(thread)) return false;
  if (message.author.kind !== "agent") return false;
  if (!message.parts.some((p) => p.type !== "subthread")) return false;
  return (
    message.parts.some((p) => p.type === "text" && p.response) ||
    (Boolean(thread.agent_ids[0]) && message.author.id !== thread.agent_ids[0])
  );
}

export function responseOf(message: Message) {
  return message.parts.flatMap((p) => (p.type === "text" && p.response ? [p.response] : []))[0];
}

/**
 * For each teammate's answer in a chat, the message above it holding that consult's card, when the chat has one (the
 * asker's chat shows it where it asked): the answer is told there, not again. `next`: the card is right above it.
 */
export function answerCards(messages: readonly Message[]): Map<string, { card: string; next: boolean }> {
  const out = new Map<string, { card: string; next: boolean }>();
  const cards = new Map<string, { id: string; at: number }>();
  messages.forEach((m, i) => {
    const response = responseOf(m);
    const card = response && cards.get(response.thread_id);
    if (card) out.set(m.id, { card: card.id, next: card.at === i - 1 });
    for (const p of m.parts) if (p.type === "subthread") cards.set(p.thread_id, { id: m.id, at: i });
  });
  return out;
}

/** What the teammate answered, out of the words APX handed the asker with it ("Scout answered…: <answer> Go on…"). */
export function answerText(text: string): string {
  const head = /^[^\n]* (?:answered your question on task|checked the task)[^\n]*:\n/.exec(text);
  if (!head) return text;
  const rest = text.slice(head[0].length);
  const tail = rest.search(/\n\n(?:Go on with the task\.|It is yours to deliver:|A report, not a verdict:)/);
  return (tail >= 0 ? rest.slice(0, tail) : rest).trim();
}
