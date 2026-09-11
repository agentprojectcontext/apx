// The prior turns two peers have already exchanged, shaped as LLM messages.
//
// This is what gives an a2a exchange MEMORY: without it every delivery is a
// stateless one-shot and the peer forgets the previous turn — which reads, from
// the thread, as an agent that was told something and ignored it.
//
// It lived inside the daemon's a2a route and now has two callers: that route,
// and the super-agent delegating through `delegateToAgent`. One home (rule 8),
// because "what has this pair said to each other" must not have two answers.
import { readProjectMessages, dedupA2A } from "#core/stores/messages.js";

/**
 * Oldest → newest, from `viewer`'s side: its own lines are `assistant`, the
 * peer's are `user`. Loaded BEFORE the current message is logged, so it
 * excludes it.
 */
export function a2aPairHistory(storageRoot, from, to, viewer, limit = 24) {
  const pair = new Set([from, to]);
  const rows = readProjectMessages(storageRoot, { channel: "a2a", limit: 300 }).filter((m) => {
    // What was SAID, and only that. The a2a ledger also carries what a tool did
    // on an agent's behalf (`type: "tool"`), whose body is the raw result: a
    // whole HTML file, a lint dump, a JSON blob. Those already passed through
    // the model inside the turn that ran them; replaying them here as
    // conversation is how the window emptied out. Measured on one real thread:
    // 18 of the last 24 rows were tool exhaust, 84% of the characters, leaving
    // six real lines to remember a multi-day job by — which is what an agent
    // that had "gone stupid" was actually reading.
    //
    // Filtering HERE rather than trusting the writers, because the raw rows
    // have had two authors already and the viewer (readProjectA2AThread) still
    // wants them: it is this function, the one building an LLM context, that
    // knows only utterances belong in it. A row with NO type is an utterance:
    // that is how comment-turn.js mirrors an agent-to-agent handover from a
    // task thread, and those belong in the history like anything else said.
    if (m.type && m.type !== "agent") return false;
    const parts = [m.agent_slug, m.author, m.meta?.from, m.meta?.to].filter(Boolean);
    return parts.length > 0 && parts.every((s) => pair.has(s));
  });
  return dedupA2A(rows)
    .sort((a, b) => (a.ts || "").localeCompare(b.ts || ""))
    .slice(-limit)
    .map((m) =>
      m.author === viewer
        ? { role: "assistant", content: m.body || "" }
        : { role: "user", content: `From ${m.author}:\n\n${m.body || ""}` },
    );
}
