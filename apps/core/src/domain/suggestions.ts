// Replies the agent drafted for a supervised contact: one row per draft, pending until the owner sends it, edits it,
// drops it, or a newer message of theirs gets a new draft (channels/suggestions.ts).
import type { ContactSuggestion, SuggestionState } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { SuggestionsTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

const saidOf = (text: string): string[] => {
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

const toSuggestion = (r: Selectable<SuggestionsTable>): ContactSuggestion => ({
  id: r.id,
  person_id: r.person_id,
  thread_id: r.thread_id,
  channel: r.channel,
  said: saidOf(r.said),
  text: r.text,
  ...opt("error", r.error),
  ...opt("model", r.model),
  state: r.state as SuggestionState,
  created_at: r.created_at,
  ...opt("decided_at", r.decided_at),
  ...opt("message_id", r.message_id),
});

export type SuggestionRecord = ContactSuggestion & { agent_id: string };

/** What clients see of a draft: not which agent wrote it (the chat's). */
export const publicSuggestion = ({ agent_id: _a, ...s }: SuggestionRecord): ContactSuggestion => s;

export function suggestionsRepo({ one, all, run }: Sql) {
  const get = (id: string): SuggestionRecord | undefined => {
    const r = one(qb.selectFrom("suggestions").selectAll().where("id", "=", id));
    return r ? { ...toSuggestion(r), agent_id: r.agent_id } : undefined;
  };
  return {
    get,
    add(s: {
      person_id: string;
      thread_id: string;
      channel: string;
      agent_id: string;
      said: string[];
      text: string;
      error?: string | undefined;
      model?: string | undefined;
    }): SuggestionRecord {
      const id = newId("sug");
      run(
        qb.insertInto("suggestions").values({
          id,
          person_id: s.person_id,
          thread_id: s.thread_id,
          channel: s.channel,
          agent_id: s.agent_id,
          said: JSON.stringify(s.said),
          text: s.text,
          error: s.error ?? null,
          model: s.model ?? null,
          state: "pending",
          created_at: now(),
        }),
      );
      return get(id) as SuggestionRecord;
    },
    list(q: { state?: SuggestionState | undefined; person?: string | undefined; limit: number }): ContactSuggestion[] {
      return all(
        qb
          .selectFrom("suggestions")
          .selectAll()
          .$if(!!q.state, (s) => s.where("state", "=", q.state as string))
          .$if(!!q.person, (s) => s.where("person_id", "=", q.person as string))
          .orderBy("created_at", "desc")
          .orderBy("id", "desc")
          .limit(q.limit),
      ).map(toSuggestion);
    },
    /** The pending drafts of a chat (at most one, unless two bursts raced). */
    pendingIn(threadId: string): SuggestionRecord[] {
      return all(
        qb.selectFrom("suggestions").selectAll().where("thread_id", "=", threadId).where("state", "=", "pending"),
      ).map((r) => ({ ...toSuggestion(r), agent_id: r.agent_id }));
    },
    /** When the latest draft of a chat the owner decided on (sent or dropped) was made: what came before is dealt with. */
    lastDecided(threadId: string): string | undefined {
      return one(
        qb
          .selectFrom("suggestions")
          .select("created_at")
          .where("thread_id", "=", threadId)
          .where("state", "in", ["sent", "discarded"])
          .orderBy("created_at", "desc")
          .limit(1),
      )?.created_at;
    },
    /** Closes a pending draft; undefined when it was not pending any more (someone decided first). */
    decide(id: string, state: Exclude<SuggestionState, "pending">, messageId?: string): SuggestionRecord | undefined {
      const changed = run(
        qb
          .updateTable("suggestions")
          .set({ state, decided_at: now(), message_id: messageId ?? null })
          .where("id", "=", id)
          .where("state", "=", "pending"),
      );
      return changed ? get(id) : undefined;
    },
  };
}
