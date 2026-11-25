// Between the owner's own agents, a role guides and rules plus records replace walls; walls stay against outsiders
// (contacts, rooms, outside apps, Flow bots, a contact agent's consult). See DECISIONS.md#d-271.
import type { Thread } from "@apx/protocol";
import type { AgentRecord } from "./agents.ts";
import { isConsult } from "./contact-consult.ts";
import { OWNER_ID } from "./persons.ts";
import type { Store } from "./store.ts";

/**
 * A chat whose turns work for the owner: neither it nor any chat it was opened from has a contact, room, outside app,
 * Flow bot or contact consult in it (a helper a contact's chat started stays theirs). An unknown or too deep line does not.
 */
export function worksForOwner(store: Store, thread: Thread): boolean {
  let t: Thread | undefined = thread;
  for (let depth = 0; t && depth <= 10; depth++) {
    if (!chatForOwner(store, t)) return false;
    if (!t.parent_id) return true;
    t = store.threads.get(t.parent_id);
  }
  return false;
}

function chatForOwner(store: Store, thread: Thread): boolean {
  const c = store.threads.context(thread.id);
  if (c.client || c.room || c.flow_step?.bot || isConsult(thread)) return false;
  return !thread.channel || thread.channel.person_id === OWNER_ID;
}

/** The agent behind an in-process call, when it is one of the owner's agents working for the owner; else undefined. */
export function ownerAgentOf(
  store: Store,
  ctx: { agent?: { id: string; thread_id: string } | undefined; client?: unknown; channel?: unknown },
): AgentRecord | undefined {
  if (!ctx.agent || ctx.client || ctx.channel) return undefined;
  const thread = store.threads.get(ctx.agent.thread_id);
  const agent = store.agents.get(ctx.agent.id);
  return thread && agent && worksForOwner(store, thread) ? agent : undefined;
}

/** Where a chat lives, in words for a tool result that crosses projects ("project Acme" or "Home"). */
export function placeName(store: Store, projectId: string | undefined): string {
  if (!projectId) return "Home";
  return `project ${store.projects.get(projectId)?.name ?? projectId}`;
}
