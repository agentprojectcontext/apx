// A channel's attention hours: a contact who writes outside them is kept unanswered, and once the hours begin their
// chat gets one turn that answers everything they sent meanwhile. The owner is always answered. See DECISIONS.md#d-136
import type { Person } from "@apx/protocol";
import { withinHours } from "../domain/hours.ts";
import { ownerTimeZone } from "../domain/owner.ts";
import type { Store } from "../domain/store.ts";
import type { AdmitFn } from "../engine/engine.ts";
import type { Suggestions } from "./suggestions.ts";
import type { ChannelConfig } from "./types.ts";

/** Chats answered per tick of the office clock once the hours begin, so a night's contacts are not all woken at once. */
const OPEN_PER_TICK = 3;

/** Whether `person` waits for the channel's hours: it has some, it is outside them, and they are not answered anyway. */
export function waitsForHours(
  store: Store,
  cfg: Pick<ChannelConfig, "hours">,
  person: Pick<Person, "role" | "any_hour">,
  at: Date,
): boolean {
  if (!cfg.hours || person.role === "owner" || person.any_hour) return false;
  return !withinHours(cfg.hours, at, ownerTimeZone(store));
}

export function createHeld(deps: {
  store: Store;
  configs(): ChannelConfig[];
  suggestions: Pick<Suggestions, "held">;
  now: () => Date;
}) {
  const { store } = deps;
  return {
    /** A contact's chat now waits for the hours; answers go back to where they wrote from. */
    hold(cfg: ChannelConfig, person: Pick<Person, "id">, threadId: string, conversation: string, sender: string): void {
      store.threads.mergeContext(threadId, { reply_to: { channel: cfg.id, conversation } });
      store.channels.held.mark({ thread_id: threadId, channel: cfg.id, conversation, sender, person_id: person.id });
    },

    /** Not waiting any more: a message of theirs in the hours is answered by its own turn, with the earlier ones in view. */
    release(threadId: string): void {
      store.channels.held.clear(threadId);
    },

    /** Each tick: chats whose channel's hours have begun get their turn, the longest waiting first. */
    open(admit: AdmitFn): number {
      const at = deps.now();
      let opened = 0;
      for (const h of store.channels.held.list()) {
        if (opened >= OPEN_PER_TICK) break;
        const cfg = deps.configs().find((c) => c.id === h.channel);
        const person = store.persons.get(h.person_id);
        const thread = store.threads.get(h.thread_id);
        // Its channel gone or off, the person silenced or blocked: nothing is answered, so nothing waits.
        if (!cfg?.enabled || !person || person.muted || person.role === "blocked" || !thread) {
          store.channels.held.clear(h.thread_id);
          continue;
        }
        if (waitsForHours(store, cfg, person, at) || !store.channels.held.clear(h.thread_id)) continue;
        opened++;
        if (person.supervised) {
          deps.suggestions.held(cfg, person, h.sender, h.thread_id);
          continue;
        }
        admit({
          thread_id: thread.id,
          agent_id: thread.agent_ids[0] ?? cfg.agent_id,
          trigger: "channel",
          origin: {
            kind: "hours_began",
            channel: cfg.id,
            conversation: h.conversation,
            person_id: person.id,
            name: person.name,
            since: h.since,
          },
          text: "",
          reply_to: { channel: cfg.id, conversation: h.conversation },
        });
      }
      return opened;
    },
  };
}

export type Held = ReturnType<typeof createHeld>;
