// What the super-agent's card in the top bar says: the work it and the agents it delegated to have in progress, and
// the last thing it said in its own chat. Pure, so the card only renders.
import type { Message, Thread } from "@apx/protocol";

type NowRow = { threadId: string; agentId: string | undefined; text: string; projectId: string | undefined };

const working = (state: Thread["state"]) => state === "submitted" || state === "working";

/**
 * Working chats of the super-agent and of any chat it started (a delegation, at any depth), newest first. A chat
 * without a title says its preview instead.
 */
export function superAgentNow(threads: Record<string, Thread>, superId: string, limit = 3): NowRow[] {
  const ownedBySuper = (th: Thread): boolean => {
    const seen = new Set<string>();
    let at: Thread | undefined = th;
    while (at && !seen.has(at.id)) {
      if (at.agent_ids[0] === superId) return true;
      seen.add(at.id);
      at = at.parent_id ? threads[at.parent_id] : undefined;
    }
    return false;
  };
  return Object.values(threads)
    .filter((th) => working(th.state) && !th.engine && ownedBySuper(th))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit)
    .map((th) => ({
      threadId: th.id,
      agentId: th.agent_ids[0],
      text: (th.kind === "home" ? th.preview : th.title || th.preview).trim() || th.title,
      projectId: th.project_id,
    }));
}

/** The newest message an agent wrote in the chat, as text; without the chat's messages loaded, its preview. */
export function lastAgentWords(
  thread: Thread | undefined,
  messages: Message[] | undefined,
): { text: string; at: string } | undefined {
  if (!thread) return undefined;
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    const m = messages?.[i];
    if (m?.author.kind !== "agent") continue;
    const text = m.parts
      .flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join(" ")
      .trim();
    if (text) return { text, at: m.created_at };
  }
  const preview = thread.preview.trim();
  return preview ? { text: preview, at: thread.updated_at } : undefined;
}
