import type { Message as Msg, Thread } from "@apx/protocol";
import { isIndividualChat } from "./agentEvent.ts";

/** The owner's own words from a channel that cannot vouch for them (D-144): still the owner's, on their side. */
export const ownerOnChannel = (m: Msg): boolean => m.author.kind === "person" && m.author.id === "owner";

/** Several speakers (agents, or other people on a channel): each one's face and name over their words, all at the left. */
export function isRoom(thread: Thread, messages: readonly Msg[]): boolean {
  const multiAgent =
    !isIndividualChat(thread) &&
    (thread.kind === "group" ||
      thread.kind === "a2a" ||
      thread.kind === "task" ||
      thread.agent_ids.length > 1 ||
      new Set(messages.flatMap((m) => (m.author.kind === "agent" ? [m.author.id] : []))).size > 1);
  return (
    multiAgent || thread.kind === "channel" || messages.some((m) => m.author.kind === "person" && !ownerOnChannel(m))
  );
}
