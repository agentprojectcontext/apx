// The owner's arrangement of chats and their management dialogs.
import type { Thread, WritePolicy } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { discardAttachments } from "./attachmentDrafts.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { keepDraft } from "./drafts.ts";
import { notify } from "./notices.ts";
import { data } from "./state.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type ThreadDialog =
  | { kind: "rename" | "delete"; thread: string }
  | { kind: "markRead"; threads: readonly string[] }
  | undefined;
const dialogs = createStore<{ open: ThreadDialog }>({ open: undefined });
export const openThreadDialog = (kind: "rename" | "delete", thread: string) => dialogs.set({ open: { kind, thread } });
export const openMarkReadDialog = (threads: readonly string[]) => {
  if (threads.length) dialogs.set({ open: { kind: "markRead", threads: [...new Set(threads)] } });
};
export const closeThreadDialog = () => dialogs.set({ open: undefined });
export const useThreadDialog = () => useSlice(dialogs, (s) => s.open);

/** Renames (`title: null` = the automatic title again), pins or archives; the list follows at once. */
export async function updateThread(
  id: string,
  patch: { title?: string | null; pinned?: boolean; archived?: boolean; write?: WritePolicy | null },
): Promise<boolean> {
  try {
    const thread = await client.call("threads.update", { thread: id, ...patch });
    data.set((s) => ({ threads: { ...s.threads, [id]: thread } }));
    return true;
  } catch (e) {
    notify(t("error.updateChat", { error: errText(e) }));
    return false;
  }
}

export async function deleteThread(id: string): Promise<boolean> {
  try {
    const { deleted } = await client.call("threads.delete", { thread: id });
    forgetThreads(deleted);
    return true;
  } catch (e) {
    notify(t("error.deleteChat", { error: errText(e) }));
    return false;
  }
}

/** Drops deleted chats from memory; one still open shows as not found instead of being fetched again. */
export function forgetThreads(ids: string[]): void {
  for (const id of ids) {
    discardAttachments(id);
    keepDraft(id, "");
  }
  data.set((s) => {
    const threads: Record<string, Thread> = { ...s.threads };
    const messages = { ...s.messages };
    const threadLoad = { ...s.threadLoad };
    for (const id of ids) {
      delete threads[id];
      delete messages[id];
      threadLoad[id] = "error";
    }
    return { threads, messages, threadLoad };
  });
}

/**
 * Edits one of the owner's messages (`text`) or asks again for an answer: the chat goes back to it and sends again.
 * The removed messages leave through the live event; the new turn arrives like any other.
 */
export async function rewindThread(thread: string, message: string, text?: string): Promise<boolean> {
  try {
    await client.call("threads.rewind", { thread, message, ...(text ? { text } : {}) });
    return true;
  } catch (e) {
    notify(t("error.rewind", { error: errText(e) }));
    return false;
  }
}

/** A new chat with this one's history up to `message` (its id), the owner's words ready when forked at them. */
export async function forkThread(thread: string, message: string, title: string): Promise<string | undefined> {
  try {
    const r = await client.call("threads.fork", { thread, message, title });
    if (r.draft) keepDraft(r.thread.id, r.draft);
    data.set((s) => ({ threads: { ...s.threads, [r.thread.id]: r.thread } }));
    return r.thread.id;
  } catch (e) {
    notify(t("error.fork", { error: errText(e) }));
    return undefined;
  }
}
