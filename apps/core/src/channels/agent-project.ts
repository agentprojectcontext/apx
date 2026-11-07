// A channel's chats live where the agent that answers them works: a project's head brings its team, folders and memory.
import type { Store } from "../domain/store.ts";

/** The project of the agent a channel hands its chats to; undefined for the super-agent and global agents. */
export const agentProject = (store: Store, agentId: string): string | undefined =>
  store.agents.get(agentId)?.project_id;
