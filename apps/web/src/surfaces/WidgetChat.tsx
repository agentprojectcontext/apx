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

/** The chat opened for a widget that had none, remembered on this device so the next click continues it. */
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

/**
 * Opens a widget's chat: the one it was made in (or last opened for it) when it is still there, else a new one with
 * the agent that made it (the super-agent when that was the owner), its first words naming the widget so the agent
 * finds it.
 */
export async function openWidgetChat(surface: SurfaceSummary): Promise<void> {
  const d = data.get();
  const known = [surface.thread_id, chatsMade()[surface.id]].find(
    (id) => id && d.threads[id] && !d.threads[id]?.archived,
  );
  let threadId = known;
  if (!threadId) {
    const home = Object.values(d.threads).find((th) => th.kind === "home");
    const agentId = d.agents[surface.created_by] ? surface.created_by : home?.agent_ids[0];
    if (!agentId) return notify(tr("widget.chatNoAgent"));
    try {
      const thread = await createThread({
        agentId,
        ...(surface.project_id ? { projectId: surface.project_id } : {}),
        title: surface.title,
      });
      putDraft(thread.id, tr("widget.chatDraft", { title: surface.title, name: surface.name }));
      threadId = thread.id;
      rememberChat(surface.id, thread.id);
    } catch (e) {
      return notify(tr("error.change", { error: errText(e) }));
    }
  }
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
        <IconButton
          size="sm"
          label={t("widget.chatOpen")}
          icon={<Icons.ExternalLink size={14} />}
          onClick={() => {
            close();
            go.inboxThread(thread.id);
          }}
        />
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
