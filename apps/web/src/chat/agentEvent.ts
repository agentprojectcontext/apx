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
