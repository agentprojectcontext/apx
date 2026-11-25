// What the super-agent's turn answering a contact's agent may reach: that project's own chats and the Drive files
// they used, while the contact's project reading still holds (DECISIONS.md#d-269).
import type { Thread } from "@apx/protocol";
import { contactProjectReading } from "./contact-project-reading.ts";
import { OWNER_ID } from "./persons.ts";
import { CONTACT_CONSULT } from "./runs.ts";
import type { Store } from "./store.ts";

/** A sub-thread where the super-agent answers for a contact's chat. */
export const isConsult = (thread: Pick<Thread, "session" | "parent_id">): boolean =>
  thread.session === CONTACT_CONSULT && Boolean(thread.parent_id);

/** The consult still answers its contact's chat: same project, and that chat's project reading still holds. */
export function consultOpen(store: Store, threadId: string): boolean {
  const sub = store.threads.get(threadId);
  const chat = sub?.parent_id ? store.threads.get(sub.parent_id) : undefined;
  if (!sub || !chat || !isConsult(sub) || !sub.project_id || sub.project_id !== chat.project_id) return false;
  const reading = contactProjectReading(store);
  return chat.agent_ids.some((agent) => reading.available(chat.id, agent));
}

/** One of the owner's own chats in the consult's project (or a sub-thread of one): never a contact's, a room or a client. */
export function consultReadsChat(store: Store, consult: Pick<Thread, "project_id">, thread: Thread): boolean {
  if (!consult.project_id || thread.project_id !== consult.project_id) return false;
  let t: Thread | undefined = thread;
  for (let depth = 0; t && depth < 10; depth++) {
    const context = store.threads.context(t.id);
    if (context.room || context.client) return false;
    if (!t.parent_id) return !t.channel || t.channel.person_id === OWNER_ID;
    t = store.threads.get(t.parent_id);
  }
  return false;
}

/** The owner's chats a consult may read. */
export const consultChats = (store: Store, consult: Pick<Thread, "project_id">): Thread[] =>
  consult.project_id
    ? store.threads
        .list({ project_id: consult.project_id, include_subthreads: true, include_archived: true, limit: null })
        .filter((t) => consultReadsChat(store, consult, t))
    : [];

/** A Drive file this project's chats already used (linked in a message or opened by a tool there). */
export function consultSeesFile(store: Store, consult: Pick<Thread, "project_id">, id: string): boolean {
  const chats = consultChats(store, consult).map((t) => t.id);
  if (!chats.length || id.length < 8) return false;
  return store.messages.mentions(id, chats) || store.runs.searchSteps([id], chats, 1).length > 0;
}
