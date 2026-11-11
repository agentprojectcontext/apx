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
