// A task's comments: what the owner and its agents wrote in the task's conversation, oldest first.

import type { Message } from "../protocol.ts";

export type TaskComment = { id: string; by: "owner" | string; text: string; at: string };

/** The written words of each message by the owner or an agent; notices, tool cards and empty turns stay out. */
export function taskComments(messages: readonly Message[]): TaskComment[] {
  return messages.flatMap((m) => {
    if (m.author.kind !== "user" && m.author.kind !== "agent") return [];
    const text = m.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n")
      .trim();
    if (!text) return [];
    return [{ id: m.id, by: m.author.kind === "agent" ? m.author.id : "owner", text, at: m.created_at }];
  });
}
