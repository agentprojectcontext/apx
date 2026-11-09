// A channel's chats live where the agent that answers them works: a project's head brings its team, folders and memory.
import type { Store } from "../domain/store.ts";

/** The project of the agent a channel hands its chats to; undefined for the super-agent and global agents. */
export const agentProject = (store: Store, agentId: string): string | undefined =>
  store.agents.get(agentId)?.project_id;

/** Home is the super-agent's one conversation with the owner: only a channel it answers may take the owner there. */
export const answersInHome = (store: Store, agentId: string): boolean =>
  store.agents.get(agentId)?.kind === "secretary";
