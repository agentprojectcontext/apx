// An agent's words posted in a chat outside a turn (a greeting, release notes, the news it tells): shown there, and
// in its history as its own words after a note of why it spoke, so it answers the owner's reply knowing it said them.
import type { Part } from "@apx/protocol";
import type { Store } from "./store.ts";
import { previewOf } from "./threads.ts";

export function postAgentWords(
  store: Store,
  o: {
    thread_id: string;
    agent_id: string;
    text: string;
    /** What the chat shows; just the words when absent. */
    parts?: Part[];
    /** What happened, as the user item its history opens with (an observation, never the agent's words). */
    note: string;
    /** What the agent's history keeps as its words, when it read more than `text` (the choices it offered). */
    said?: string;
    /** Counted as news in the chat list: the owner was not there when it was said. */
    unread: boolean;
  },
): void {
  store.tx(() => {
    store.messages.add({
      thread_id: o.thread_id,
      author: { kind: "agent", id: o.agent_id },
      parts: o.parts ?? [{ type: "text", text: o.text }],
    });
    store.modelLog.append(o.thread_id, undefined, [
      { role: "user", content: o.note },
      { role: "assistant", content: o.said ?? o.text },
    ]);
    const unread = (store.threads.get(o.thread_id)?.unread ?? 0) + 1;
    store.threads.patch(o.thread_id, { preview: previewOf(o.text), ...(o.unread ? { unread } : {}) });
  });
}
