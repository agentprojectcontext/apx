import type { SurfaceSummary } from "@apx/protocol";
import { IconButton, Icons, Skeleton } from "@apx/ui";
import { useEffect } from "react";
import { ChatComposer } from "../chat/composer/ChatComposer.tsx";
import { Transcript } from "../chat/Transcript.tsx";
import { Drawer } from "../common/Drawer.tsx";
import { createThread, loadThread } from "../data/actions.ts";
import { createStore, useSlice } from "../data/createStore.ts";
import { notify } from "../data/notices.ts";
import { data, useData } from "../data/state.ts";
import { putDraft } from "../data/threadAdmin.ts";
import { t as tr, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { SurfaceFrame } from "./SurfaceFrame.tsx";

/** The widget whose chat is open over the page, and the chat. */
const open = createStore<{ surfaceId?: string; threadId?: string }>({});

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
function rememberChat(surfaceId: string, threadId: string) {
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
    putDraft(thread.id, tr("widget.chatDraft", { title: surface.title, name: surface.name }));
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
async function restartChat(surface: SurfaceSummary): Promise<void> {
  const threadId = await newChat(surface);
  if (!threadId) return;
  rememberChat(surface.id, threadId);
  open.set({ surfaceId: surface.id, threadId });
}

const close = () => open.set({ surfaceId: undefined, threadId: undefined });

/**
 * The open widget's chat, floating over the page like a task: the widget live on top, the conversation and the
 * composer below, so the owner asks for a change and watches it land.
 */
export function WidgetChatHost() {
  const t = useT();
  const { surfaceId, threadId } = useSlice(open, (s) => s);
  const surface = useData((s) => (surfaceId ? s.surfaces[surfaceId] : undefined));
  const thread = useData((s) => (threadId ? s.threads[threadId] : undefined));
  const load = useData((s) => (threadId ? s.threadLoad[threadId] : undefined));
  const agent = useData((s) => (thread ? s.agents[thread.agent_ids[0] ?? ""] : undefined));
  useEffect(() => {
    if (threadId && load == null) void loadThread(threadId);
  }, [threadId, load]);
  if (!surface || !thread) return null;
  return (
    <Drawer
      key={thread.id}
      className="widgetchat"
      label={t("widget.chatOf", { title: surface.title })}
      title={surface.title}
      onClose={close}
      actions={
        <>
          <IconButton
            size="sm"
            label={t("widget.chatNew")}
            icon={<Icons.Plus size={14} />}
            onClick={() => void restartChat(surface)}
          />
          <IconButton
            size="sm"
            label={t("widget.chatOpen")}
            icon={<Icons.ExternalLink size={14} />}
            onClick={() => {
              close();
              go.inboxThread(thread.id);
            }}
          />
        </>
      }
    >
      <div className="widgetchat__preview">
        <SurfaceFrame surfaceId={surface.id} maxHeight={420} />
      </div>
      <div className="widgetchat__chat">
        {load === "ready" ? <Transcript thread={thread} /> : load !== "error" && <Skeleton height={120} />}
      </div>
      <ChatComposer thread={thread} agent={agent} />
    </Drawer>
  );
}
