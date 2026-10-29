// The editor's chat with the super-agent about the open Flow: which chat each Flow continues, and making a new one.
import { createThread } from "../data/actions.ts";
import { notify } from "../data/notices.ts";
import { data } from "../data/state.ts";
import { t as tr } from "../i18n/index.ts";

/** The last chat used for each Flow, remembered on this device so the next "Ask" continues it. */
const CHATS_KEY = "apx.flowChats";
function chatsMade(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CHATS_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}
export function rememberFlowChat(flow: string, thread: string): void {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify({ ...chatsMade(), [flow]: thread }));
  } catch {}
}

/** The Flow's chat when it is still there (not archived nor deleted). */
export function flowChatOf(flow: string): string | undefined {
  const id = chatsMade()[flow];
  const thread = id ? data.get().threads[id] : undefined;
  return thread && !thread.archived && thread.kind !== "home" ? id : undefined;
}

/** A new chat with the agent in the Flow's project, so it works with the project's context. */
export async function newFlowChat(agentId: string, projectId: string, title: string): Promise<string | undefined> {
  try {
    return (await createThread({ agentId, projectId, title })).id;
  } catch (e) {
    notify(tr("error.change", { error: e instanceof Error ? e.message : String(e) }));
    return undefined;
  }
}

/** Whether the chat has nothing in it yet: its first message says which Flow it is about. */
export const chatIsEmpty = (thread: string): boolean => !data.get().messages[thread]?.length;
