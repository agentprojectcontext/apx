import { http, unwrapPage } from "../http";

/** One row of the agent inbox: an agent, and the last thing it said. */
export interface InboxRow {
  project_id: number | string | null;
  project_name: string | null;
  project_path: string | null;
  agent_slug: string;
  agent_name: string | null;
  agent_emoji: string | null;
  kind: "agent" | "super_agent";
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
      .get<unknown>(`/inbox${includeEmpty ? "?include_empty=1" : ""}`)
      .then((b) => unwrapPage<InboxRow>(b).items),
};
