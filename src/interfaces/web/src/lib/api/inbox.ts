import { http, unwrapPage } from "../http";
import type { ActiveTurn, AgentFace } from "../../types/daemon";

/** One row of the agent inbox: an agent, and the last thing it said. */
export interface InboxRow {
  project_id: number | string | null;
  project_name: string | null;
  project_path: string | null;
  agent_slug: string;
  agent_name: string | null;
  agent_emoji: string | null;
  /** Blob-preset key for the animated avatar (see components/agents/blobPresets). */
  agent_icon: string | null;
  kind: "agent" | "super_agent" | "a2a" | "group";
  /** For a2a and group chats: the participant slugs, for the multi-face avatar. */
  participants?: string[];
  /** Resolved face per participant (blob/emoji/name) so the duo wears real
   *  avatars — the same shape, from the same resolver, that a thread carries. */
  participant_faces?: AgentFace[];
  /** For a2a spawned on someone's behalf: who asked for it ("a pedido de X"). */
  requested_by?: string | null;
  /** Set when this row is one PERSON's conversation inside a channel that
   *  carries several (WhatsApp): their stable key, and the face to draw. */
  contact?: string;
  contact_name?: string | null;
  contact_face?: AgentFace;
  /** WHICH PERSON, resolved against the roster as it stands today — stable
   *  across days and across the addresses one human writes from, so it is what
   *  identifies the row (see rowKey) rather than the key the ledger recorded. */
  contact_person?: string | null;
  pinned: boolean;
  conversation_id: string | null;
  channel: string | null;
  messages: number;
  /** What the AGENT last said — not what the user last asked. This is the one
   *  a notification reads out; it is deliberately blind to your own messages. */
  preview: string | null;
  /** The thread's last LINE, whoever wrote it — which is what the row PRINTS.
   *  Absent on a2a and group rows, whose `preview` already is the last line
   *  with its author named in it. */
  last_message?: string | null;
  /** Who wrote `last_message` — so the row can say "Vos:" over your own. Tool
   *  rows are work, not lines, and never appear here. */
  last_role?: "user" | "assistant" | null;
  /** WHEN it said that. Distinct from `last_activity_at`, which also moves for
   *  the owner's own send and for every tool row of a turn — see lib/notify.ts,
   *  where the difference is one bell per answer instead of one per step. */
  preview_at?: string | null;
  last_activity_at: string;
  /** Daemon-owned status; survives navigation and is shared by every rail. */
  active_turn?: ActiveTurn | null;
  /** Has the agent said something here that nobody has read yet?
   *
   *  The DAEMON's answer, not this browser's. It used to be worked out per
   *  device in localStorage, which meant an afternoon of reading on the laptop
   *  left forty blue rows on the phone — every one of them already read. See
   *  core/stores/read-marks.js and lib/chat-read.ts. */
  unread?: boolean;
}

/** One row's identity plus the utterance that was read. The timestamp the
 *  reader HAD, never `now`: an answer that landed between the fetch and the
 *  call has not been read by anybody. */
export interface ReadMark {
  project_id: number | string | null;
  agent_slug: string;
  channel: string | null;
  contact_person?: string | null;
  at: string;
}

export const Inbox = {
  /** `channel` scopes the individual-agent rows to one channel (e.g. "web") so a
   *  Telegram thread never surfaces on the inbox or the phone. a2a group rows are
   *  always included. Omit it for the full, every-channel list. */
  list: (includeEmpty = false, channel?: string) => {
    const params = new URLSearchParams();
    if (includeEmpty) params.set("include_empty", "1");
    if (channel) params.set("channel", channel);
    const qs = params.toString();
    return http
      .get<unknown>(`/api/inbox${qs ? `?${qs}` : ""}`)
      .then((b) => unwrapPage<InboxRow>(b).items);
  },

  /** Record that these rows were read — for every surface, not just this one. */
  markRead: (rows: ReadMark[]) =>
    http.post<{ ok: boolean; marked: number }>("/api/inbox/read", { rows }),
};
