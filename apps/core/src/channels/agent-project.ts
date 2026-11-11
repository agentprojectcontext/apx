// A channel's chats live where the agent that answers them works: a project's head brings its team, folders and memory.
import type { Store } from "../domain/store.ts";
import { type ChannelConfig, contactAgentOf } from "./types.ts";

/** The project of the agent a channel hands its chats to; undefined for the super-agent and global agents. */
export const agentProject = (store: Store, agentId: string): string | undefined =>
  store.agents.get(agentId)?.project_id;

/** Home is the super-agent's one conversation with the owner: only a channel it answers may take the owner there. */
export const answersInHome = (store: Store, agentId: string): boolean =>
  store.agents.get(agentId)?.kind === "secretary";

/**
 * Who answers a contact on this channel: the agent the owner gave that person, while it exists, else the account's
 * contacts agent.
 */
export const contactAnswerer = (
  store: Store,
  cfg: Pick<ChannelConfig, "agent_id" | "contacts_agent_id">,
  person: { agent_id?: string | undefined } | undefined,
): string => (person?.agent_id && store.agents.get(person.agent_id) ? person.agent_id : contactAgentOf(cfg));

/** Who answers a room: the agent the owner gave that room, while it exists, else the account's contacts agent. */
export const roomAnswerer = (
  store: Store,
  cfg: Pick<ChannelConfig, "agent_id" | "contacts_agent_id">,
  room: { agent_id?: string | undefined } | undefined,
): string => (room?.agent_id && store.agents.get(room.agent_id) ? room.agent_id : contactAgentOf(cfg));
