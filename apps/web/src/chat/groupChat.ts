import type { Agent, Thread } from "@apx/protocol";
import { useEffect, useMemo } from "react";
import { loadDelegated } from "../data/actions.ts";
import { isWorking } from "../data/identity.ts";
import { isNewChat } from "../data/newChat.ts";
import { useData, useShownAgents } from "../data/state.ts";

export interface GroupView {
  members: Agent[];
  /** The member answering now, while the group is at work (undefined while it picks who answers). */
  speaker: Agent | undefined;
  /** Each member's own chat under the group, once it worked there. */
  chats: Record<string, string>;
}

/** A group chat's members and who of them answers now; undefined for any other chat. */
export function useGroupChat(thread: Thread): GroupView | undefined {
  const group = thread.kind === "group";
  const agents = useShownAgents();
  const threads = useData((s) => s.threads);
  // The members' own chats come with the group: who is answering is read from them.
  useEffect(() => {
    if (group && !isNewChat(thread.id)) void loadDelegated(thread.id);
  }, [group, thread.id]);
  return useMemo(() => {
    if (!group) return undefined;
    const chats: Record<string, string> = {};
    let speaking: string | undefined;
    for (const t of Object.values(threads)) {
      const id = t.agent_ids[0];
      if (t.parent_id !== thread.id || !id) continue;
      chats[id] = t.id;
      if (isWorking(t.state)) speaking = id;
    }
    const members = thread.agent_ids.flatMap((id) => (agents[id] ? [agents[id]] : []));
    return { members, speaker: speaking && isWorking(thread.state) ? agents[speaking] : undefined, chats };
  }, [group, threads, thread.id, thread.agent_ids, thread.state, agents]);
}
