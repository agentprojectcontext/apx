import { http, unwrapPage } from "../http";

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
  kind: "agent" | "super_agent" | "a2a";
  /** For a2a group chats: the two (or more) participant slugs, for the duo avatar. */
  participants?: string[];
  /** Resolved face per participant (blob/emoji/name) so the duo wears real avatars. */
  participant_faces?: { name?: string | null; emoji?: string | null; icon?: string | null }[];
  /** For a2a spawned on someone's behalf: who asked for it ("a pedido de X"). */
  requested_by?: string | null;
  pinned: boolean;
  conversation_id: string | null;
  channel: string | null;
  messages: number;
  /** What the AGENT last said — not what the user last asked. */
  preview: string | null;
  last_activity_at: string;
}

export const Inbox = {
  list: (includeEmpty = false) =>
    http
      .get<unknown>(`/api/inbox${includeEmpty ? "?include_empty=1" : ""}`)
      .then((b) => unwrapPage<InboxRow>(b).items),
};
