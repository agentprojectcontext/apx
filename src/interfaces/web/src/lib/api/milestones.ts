import { http } from "../http";

// "dropped" = filed by mistake. Deliberately not a synonym for "failed": one
// says the work did not work, the other says it was never attempted, and
// counting them together would ruin the only number on this screen worth
// reading.
export type MilestoneState = "open" | "done" | "failed" | "dropped";

/**
 * What a STEP can be, which is more than a declared milestone can.
 *
 * "superseded": its own sender replaced it — the same text sent twice, or
 * another message seconds later. Kept so the row count still matches the chat,
 * counted as nothing, because nobody is waiting on it.
 *
 * "running": being written as you read this. Not in the transcript at all (the
 * request is on disk before the model is called, so a live turn and one the
 * daemon died inside look identical there) — the daemon's register of live
 * turns is what decides it, and the API applies it on the way out.
 */
export type StepState = MilestoneState | "superseded" | "running";

/** Why a step was superseded. The two read differently to the person who caused
 *  them: "you sent this twice" is worth noticing, "you changed your mind" is not. */
export type SupersededReason = "repeated" | "replaced";

/** One step the agent DECLARED (mark_milestone). */
export type MilestoneEntry = {
  id: string;
  state: MilestoneState;
  title: string;
  track: string | null;
  detail: string | null;
  started_at: string;
  updated_at: string;
  closed_at: string | null;
  note: string | null;
  channel: string | null;
  conversation_id: string | null;
  agent: string | null;
};

/**
 * One entry on a timeline.
 *
 * `kind: "derived"` is a request read off the transcript — it exists whether or
 * not the agent declared anything, which is what keeps a timeline from being
 * empty in the chats nobody instrumented. `kind: "declared"` is a milestone
 * that matched no request and stands on its own rather than being dropped.
 */
export type TimelineEntry = {
  kind: "derived" | "declared";
  index?: number;
  title: string;
  state: StepState;
  superseded_reason?: SupersededReason | null;
  started_at: string | null;
  ended_at?: string | null;
  answered?: boolean;
  tools?: { total: number; failed: number; names: string[] };
  /** What the turn SHOWED a reader ("Magui"). Not an address. */
  agent?: string | null;
  /** What addresses it. Only the cross-chat view carries one. */
  agent_slug?: string | null;
  model?: string | null;
  channel?: string | null;
  conversation_id?: string | null;
  milestones: MilestoneEntry[];
};

export type TimelineStats = {
  total: number;
  open: number;
  done: number;
  failed: number;
  superseded: number;
  running: number;
};

export type Timeline = {
  entries: TimelineEntry[];
  stats: TimelineStats;
  declared?: { total: number; open: number; done: number; failed: number; dropped: number };
};

export const Milestones = {
  /** One chat's timeline — derived from its conversation file. */
  forConversation: (pid: string, agent: string, conversationId: string) =>
    http.get<Timeline>(
      `/api/projects/${pid}/agents/${agent}/conversations/${conversationId}/milestones`
    ),
  /** One ledger thread — the super-agent's own chats, a2a, group rooms. */
  forThread: (pid: string, channel: string, threadId: string) =>
    http.get<Timeline>(
      `/api/projects/${pid}/super-agent/threads/${encodeURIComponent(channel)}/${encodeURIComponent(threadId)}/milestones`
    ),
  /** Across chats — built from the ledger, so a range costs its own days. */
  forProject: (pid: string, o: { since?: string; until?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (o.since) p.set("since", o.since);
    if (o.until) p.set("until", o.until);
    if (o.limit) p.set("limit", String(o.limit));
    const q = p.toString();
    return http.get<Timeline>(`/api/projects/${pid}/milestones${q ? `?${q}` : ""}`);
  },
  close: (pid: string, id: string, state: MilestoneState, note?: string) =>
    http.post<MilestoneEntry>(`/api/projects/${pid}/milestones/${id}/close`, { state, note }),
};
