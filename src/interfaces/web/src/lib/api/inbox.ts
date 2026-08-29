import { http, unwrapPage } from "../http";
import type { AgentFace } from "../../types/daemon";

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
  pinned: boolean;
  conversation_id: string | null;
  channel: string | null;
  messages: number;
  /** What the AGENT last said — not what the user last asked. */
  preview: string | null;
  /** WHEN it said that. Distinct from `last_activity_at`, which also moves for
   *  the owner's own send and for every tool row of a turn — see lib/notify.ts,
   *  where the difference is one bell per answer instead of one per step. */
  preview_at?: string | null;
  last_activity_at: string;
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
};
