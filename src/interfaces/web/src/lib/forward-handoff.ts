// A forward waiting for the screen it is going to.
//
// Forwarding inside one project is a local matter: the chat pane selects the
// target session, loads it and sends. Across projects it cannot be, because the
// pane IS the project — `<ChatTab key={pid}>` is remounted on every project
// switch, on purpose, so that landing on a new project cannot leave you reading
// the old one's chat. The component that accepted the forward is therefore gone
// by the time the destination exists.
//
// So the message waits here, in the module, between the click and the mount.
// The same shape the chat queue uses for the same reason (`backgroundQueues` in
// hooks/useChat.ts): ownership follows the CHAT, not whichever pane happens to
// be on screen.
//
// Deliberately in memory only, and this is the one decision here worth
// defending. A parked forward is an unsent message with a side effect — it runs
// a turn the moment it is picked up — and localStorage would mean a page
// reloaded an hour later fires it into a conversation nobody was looking at. A
// forward that is lost to a refresh is a forward you send again; one that
// survives a refresh is one you cannot stop.
import type { ChatKey } from "../components/chat/ChatList";
import { chatKeyToString } from "../components/chat/ChatList";
import type { Forwarded } from "./forwarded";

export interface ParkedForward {
  note: string;
  fwd: Forwarded;
}

const parked = new Map<string, ParkedForward>();

const addr = (pid: string, key: ChatKey) => `${pid}|${chatKeyToString(key)}`;

/** Leave a forward for the chat that is about to open. */
export function parkForward(pid: string, key: ChatKey, payload: ParkedForward) {
  parked.set(addr(pid, key), payload);
}

/** Is one waiting here? Asked by the loader, which has to stand aside for it —
 *  reading it without taking it, because taking it is the sender's job. */
export function peekForward(pid: string, key: ChatKey): boolean {
  return parked.has(addr(pid, key));
}

/** Take it, once. A forward runs a turn, so the second caller must get nothing:
 *  two panes mounted on the same chat would otherwise send it twice. */
export function takeForward(pid: string, key: ChatKey): ParkedForward | null {
  const address = addr(pid, key);
  const found = parked.get(address);
  if (!found) return null;
  parked.delete(address);
  return found;
}
