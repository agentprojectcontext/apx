import type { SurfaceSummary } from "@apx/protocol";
import { createThread } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { keepDraft } from "../data/drafts.ts";
import { secretary } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { data } from "../data/state.ts";
import { deleteThread } from "../data/threadAdmin.ts";
import { t as tr } from "../i18n/index.ts";
import { widgetChatOpen as open } from "./widgetChatOpen.ts";

// What opens a widget's chat, apart from the chat itself (WidgetChat.tsx, loaded late): menus import this, not it.
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The last chat used for each widget, remembered on this device so the next click continues it. */
const CHATS_KEY = "apx.widgetChats";
function chatsMade(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CHATS_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}
export function rememberChat(surfaceId: string, threadId: string) {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify({ ...chatsMade(), [surfaceId]: threadId }));
  } catch {}
}

/** A new chat about the widget with the agent that made it (the super-agent when that was the owner). */
async function newChat(surface: SurfaceSummary): Promise<string | undefined> {
  const d = data.get();
  const home = Object.values(d.threads).find((th) => th.kind === "home");
  const agentId = d.agents[surface.created_by] ? surface.created_by : home?.agent_ids[0];
  if (!agentId) {
    notify(tr("widget.chatNoAgent"));
    return undefined;
  }
  try {
    const thread = await createThread({
      agentId,
      ...(surface.project_id ? { projectId: surface.project_id } : {}),
      title: surface.title,
    });
    // Its first words name the widget, so the agent updates that one instead of making another.
    keepDraft(thread.id, tr("widget.chatDraft", { title: surface.title, name: surface.name }));
    return thread.id;
  } catch (e) {
    notify(tr("error.change", { error: errText(e) }));
    return undefined;
  }
}

/**
 * Opens a widget's chat: the last one used for it, else the one it was made in — unless that was the super-agent's
 * main chat, too broad to keep a widget in — else a new one. The one opened becomes the widget's chat.
 */
export async function openWidgetChat(surface: SurfaceSummary): Promise<void> {
  const d = data.get();
  const usable = (id: string | undefined) =>
    id && d.threads[id] && !d.threads[id]?.archived && d.threads[id]?.kind !== "home" ? id : undefined;
  const threadId = usable(chatsMade()[surface.id]) ?? usable(surface.thread_id) ?? (await newChat(surface));
  if (!threadId) return;
  rememberChat(surface.id, threadId);
  open.set({ surfaceId: surface.id, threadId });
}

/** Starts the widget's chat over: a new session, which from then on is the widget's chat. */
export async function restartChat(surface: SurfaceSummary): Promise<void> {
  const threadId = await newChat(surface);
  if (!threadId) return;
  rememberChat(surface.id, threadId);
  open.set({ surfaceId: surface.id, threadId });
}

/** Chats opened here to ask for a new widget: one closed before anything was written in it is not kept. */
export const asking = new Set<string>();

export const close = () => {
  const { threadId } = open.get();
  open.set({ surfaceId: undefined, threadId: undefined });
  if (!threadId || !asking.has(threadId)) return;
  asking.delete(threadId);
  void client
    .call("threads.get", { thread: threadId })
    .then(({ messages }) => (messages.length ? undefined : deleteThread(threadId)))
    .catch(() => undefined);
};

/**
 * Asks an agent for a new widget for a project's board: a new chat with it in that project (so it works with the
 * project's context), its first words ready, floating over the page; the widget shows on top as soon as it is made.
 */
export async function askForWidget(
  agentId: string,
  projectId: string | undefined,
  words: { title: string; draft: string } = { title: tr("widget.askTitle"), draft: tr("widget.askDraft") },
): Promise<void> {
  try {
    const thread = await createThread({ agentId, ...(projectId ? { projectId } : {}), title: words.title });
    asking.add(thread.id);
    keepDraft(thread.id, words.draft);
    open.set({ surfaceId: undefined, threadId: thread.id });
  } catch (e) {
    notify(tr("error.change", { error: errText(e) }));
  }
}

/** A new artifact from the Apps dock: a new chat with the super-agent, its first words ready for the owner to finish. */
export function createArtifact(): void {
  const boss = secretary(data.get().agents);
  if (!boss) return;
  void askForWidget(boss.id, undefined, { title: tr("artifact.createTitle"), draft: tr("artifact.createDraft") });
}
