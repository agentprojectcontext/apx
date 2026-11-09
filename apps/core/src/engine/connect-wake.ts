// The owner connected an app or channel an agent offered on a card: that agent gets a turn to go on with what they
// asked, wherever the owner connected it from (the card, Settings, the terminal) and however the chat moved on.
import type { Store } from "../domain/store.ts";
import type { AdmitFn } from "./engine.ts";

/** An offer older than this is not waiting anymore: connecting it then is the owner's own business. */
const WAITING_MS = 2 * 24 * 60 * 60 * 1000;

export type Connected = { what: "integration" | "channel"; id: string };

export function wakeAfterConnect(store: Store, admit: AdmitFn, c: Connected, at = Date.now()): void {
  const since = new Date(at - WAITING_MS).toISOString();
  const woken = new Set<string>();
  for (const m of store.messages.withConnectOffer(c.what, c.id, since)) {
    // The newest card in each chat speaks for it; a chat is woken once.
    if (woken.has(m.thread_id)) continue;
    woken.add(m.thread_id);
    if (m.author.kind !== "agent") continue;
    const agent = store.agents.get(m.author.id);
    const thread = store.threads.get(m.thread_id);
    if (!agent || !thread || thread.archived) continue;
    // Connected again (signed in once more, a second account): the card was already answered.
    const answered = store.runs
      .list(m.thread_id, 50)
      .some((r) => r.input?.origin.kind === "connected" && r.input.origin.message_id === m.id);
    if (answered) continue;
    const offer = m.parts
      .flatMap((p) => (p.type === "connect" ? p.offers : []))
      .find((o) => o.kind === c.what && o.id === c.id);
    const label = offer?.label ?? c.id;
    admit({
      thread_id: m.thread_id,
      agent_id: agent.id,
      // The owner's own step, like answering a question the agent asked.
      trigger: "user",
      origin: { kind: "connected", what: c.what, id: c.id, label, message_id: m.id },
      text: `Connected: ${label}`,
    });
  }
}
