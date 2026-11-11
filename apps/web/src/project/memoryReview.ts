// The chat that reviews memory notes with an agent, beside the Memory tab: who reviews, which chat continues, its
// first words, and dropping a chat closed before anything was written in it.
import type { Memory } from "@apx/protocol";
import { createThread } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { draftOf, keepDraft } from "../data/drafts.ts";
import { secretary } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { data } from "../data/state.ts";
import { deleteThread } from "../data/threadAdmin.ts";
import { t as tr } from "../i18n/index.ts";

export type ReviewShelf = "project" | "global" | "agent";

/** What a review is about: a place's shelf of notes, or one note on it. */
export type ReviewOf = { shelf: ReviewShelf; projectId: string | undefined; note?: Memory };

/** A private note is reviewed by the agent whose notebook it is; every other note by the super-agent. */
export function reviewerOf(of: ReviewOf): string | undefined {
  const agents = data.get().agents;
  const owner = of.note?.scope === "agent" ? of.note.agent_id : undefined;
  if (owner && agents[owner]) return owner;
  return of.shelf === "agent" ? undefined : secretary(agents)?.id;
}

/** The last review chat of each place and agent, remembered on this device so the next click continues it. */
const CHATS_KEY = "apx.memoryChats";
function chatsMade(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CHATS_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function remember(key: string, thread: string): void {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify({ ...chatsMade(), [key]: thread }));
  } catch {}
}
const keyOf = (of: ReviewOf, agent: string) => `${of.projectId ?? "~"}:${of.shelf}:${agent}`;

function usable(id: string | undefined): string | undefined {
  const thread = id ? data.get().threads[id] : undefined;
  return thread && !thread.archived && thread.kind !== "home" ? id : undefined;
}

/** Chats opened here and not written in yet: closed so, they are not kept. */
const untouched = new Set<string>();
/** The first words last put in each chat: replaced by the next ones, unlike words the owner wrote. */
const offered = new Map<string, string>();

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The note as the first words quote it: one line, and not the whole of a long one. */
const quoted = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 600 ? `${line.slice(0, 599)}…` : line;
};

/**
 * Opens the review: the place's last review chat with that agent, else a new one in the place (so the agent works with
 * its notes). Its first words say what to review, unless the owner already left words of their own in it.
 */
export async function openReview(of: ReviewOf, restart = false): Promise<string | undefined> {
  const agentId = reviewerOf(of);
  if (!agentId) {
    notify(tr("memory.review.noAgent"));
    return undefined;
  }
  const key = keyOf(of, agentId);
  let thread = restart ? undefined : usable(chatsMade()[key]);
  if (!thread) {
    try {
      thread = (
        await createThread({
          agentId,
          ...(of.projectId ? { projectId: of.projectId } : {}),
          title: tr("memory.review.title"),
        })
      ).id;
    } catch (e) {
      notify(tr("error.change", { error: errText(e) }));
      return undefined;
    }
    untouched.add(thread);
    remember(key, thread);
  }
  const words = of.note
    ? tr("memory.review.draft.note", { id: of.note.id, text: quoted(of.note.text) })
    : tr(`memory.review.draft.${of.shelf}`);
  const draft = draftOf(thread);
  if (!draft.trim() || draft === offered.get(thread)) {
    keepDraft(thread, words);
    offered.set(thread, words);
  }
  return thread;
}

/** Closing the review: a chat opened here with nothing sent is removed, as if it had not been opened. */
export function closeReview(thread: string): void {
  if (!untouched.delete(thread)) return;
  void client
    .call("threads.get", { thread })
    .then(({ messages }) => {
      if (messages.length) return;
      keepDraft(thread, "");
      return deleteThread(thread);
    })
    .catch(() => undefined);
}

/** Opened whole from the drawer: the owner's chat now, kept even with nothing sent. */
export function keepReview(thread: string): void {
  untouched.delete(thread);
}
