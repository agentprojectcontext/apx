// A chat the owner opened but has not written in yet. It lives only on the phone, under an id of its own, and the core
// makes it with its first message: opening "New chat" and leaving leaves nothing behind.
import type { Thread } from "../hooks/useWorkspace";

/** Who the new chat is with, where, and the outside engine when it is a session with one. */
export type NewChat = { agent: string; project?: string; engine?: string };

const PREFIX = "new:";

/** The same agent, project and engine give the same id, so a new chat opened again finds its draft. */
export const newChatId = (c: NewChat): string =>
  PREFIX + [c.agent, c.project ?? "", c.engine ?? ""].map(encodeURIComponent).join(":");

export const isNewChat = (id: string | undefined): boolean => Boolean(id?.startsWith(PREFIX));

export function parseNewChat(id: string): NewChat | undefined {
  if (!isNewChat(id)) return undefined;
  const [agent = "", project = "", engine = ""] = id.slice(PREFIX.length).split(":").map(decodeURIComponent);
  if (!agent) return undefined;
  return { agent, ...(project ? { project } : {}), ...(engine ? { engine } : {}) };
}

/** A new chat as a thread the chat screen can show until it is made. */
export function newChatThread(c: NewChat, title: string): Thread {
  return {
    id: newChatId(c),
    kind: c.engine ? "code" : "loose",
    title,
    agent_ids: [c.agent],
    ...(c.project ? { project_id: c.project } : {}),
    ...(c.engine ? { engine: c.engine } : {}),
    state: "idle",
    preview: "",
    unread: 0,
    updated_at: new Date().toISOString(),
  };
}
