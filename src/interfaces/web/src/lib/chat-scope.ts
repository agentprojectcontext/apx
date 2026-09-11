// Which sessions a chat's switcher may offer.
//
// Pure, and in `lib/` rather than inside SessionPicker.tsx, for the reason every
// other rule in here is: it is a decision, not a rendering, and a decision that
// was wrong three different ways deserves to be exercised directly instead of
// eyeballed through a dropdown. (Node strips types from a `.ts`; it cannot from
// a `.tsx`, which is the practical half of the same point.)
import type { ChatKey } from "../components/chat/ChatList";
// Extensionful on purpose: `allowImportingTsExtensions` is on, Vite/esbuild
// resolve it, and it is what lets Node import this file directly in a test —
// the whole reason the rule lives in `lib/` instead of inside the dropdown.
import { threadContact } from "./thread-id.ts";

/**
 * WHICH CONVERSATION the switcher must stay inside.
 *
 * Not a property of the surface — a property of the CHAT you have open. It was
 * a surface setting (`channelScope`), and every answer that gave was wrong:
 * the inbox passed "web", so opening a WhatsApp thread listed web sessions and
 * the thread you were actually reading was missing from its own switcher; the
 * phone passed nothing to escape that, so opening Rodri's WhatsApp offered
 * every thread APX has — Telegram days, the log, the CLI, and four other
 * people's WhatsApp conversations, all in one menu; and `/p/:pid/chat` passed
 * nothing at all, so the same conversation opened from the project and from the
 * inbox showed two different lists.
 *
 * A session is "the same conversation, another day". So the scope is the open
 * chat's channel, plus its person where the channel carries several. A thread
 * carries its channel in the selection. A conversation file carries it in its
 * own frontmatter, which is what `chatChannel` hands in — reading it off the
 * surface instead was the last place a pane could still disagree with the chat
 * inside it. A live session has no history yet, so its channel is the one its
 * first message will go out on: web.
 */
export interface ChatScope {
  channel?: string;
  /** The open thread, so the fetched list can be asked WHO it belongs to. */
  threadId?: string;
  /** The raw contact key in that id, if any. Only a fallback: the daemon's
   *  resolved `contact_person` is what rows are actually compared by, because
   *  one person writes from several addresses. */
  contact?: string;
}

export function chatScope(selected: ChatKey, chatChannel?: string): ChatScope {
  if (selected.kind !== "thread") return { channel: chatChannel || "web" };
  return {
    // The selection is the authority for a thread — it IS addressed by channel
    // — and `chatChannel` is the fallback for the beat before the fetch lands.
    channel: selected.channel || chatChannel,
    threadId: selected.threadId,
    contact: threadContact(selected.threadId),
  };
}

/** Which PERSON a thread belongs to, in the spelling two threads can be
 *  compared by. The daemon resolves addresses to one key per human; the id
 *  suffix is the fallback for a thread it could not resolve. */
export function personOf(th: { contact_person?: string | null; contact?: string; id: string }): string | undefined {
  return th.contact_person || th.contact || threadContact(th.id);
}

