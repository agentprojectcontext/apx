// The owner's arrangement of chats (rename, pin, archive) and deleting one, plus which of their dialogs is open.
import type { Thread } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";
import { data } from "./state.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type ThreadDialog = { kind: "rename" | "delete"; thread: string } | undefined;
const dialogs = createStore<{ open: ThreadDialog }>({ open: undefined });
export const openThreadDialog = (kind: "rename" | "delete", thread: string) => dialogs.set({ open: { kind, thread } });
export const closeThreadDialog = () => dialogs.set({ open: undefined });
export const useThreadDialog = () => useSlice(dialogs, (s) => s.open);

/** Renames (`title: null` = the automatic title again), pins or archives; the list follows at once. */
export async function updateThread(
  id: string,
  patch: { title?: string | null; pinned?: boolean; archived?: boolean },
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
