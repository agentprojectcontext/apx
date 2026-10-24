import type { SurfaceSummary } from "@apx/protocol";
import { IconButton, Icons, Skeleton } from "@apx/ui";
import { useEffect } from "react";
import { ChatComposer } from "../chat/composer/ChatComposer.tsx";
import { Transcript } from "../chat/Transcript.tsx";
import { Drawer } from "../common/Drawer.tsx";
import { loadThread } from "../data/actions.ts";
import { useSlice } from "../data/createStore.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { SurfaceFrame } from "./SurfaceFrame.tsx";
import { asking, close, rememberChat, restartChat } from "./widgetChatActions.ts";
import { widgetChatOpen as open } from "./widgetChatOpen.ts";

/**
 * The open widget's chat, floating over the page like a task: the widget live on top, the conversation and the
 * composer below, so the owner asks for a change and watches it land. Asking for a new one, the widget the chat makes
 * shows there once it exists (and becomes the widget's chat).
 */
export function WidgetChatHost() {
  const t = useT();
  const { surfaceId, threadId } = useSlice(open, (s) => s);
  const surface = useData((s) => {
    if (surfaceId) return s.surfaces[surfaceId];
    if (!threadId) return undefined;
    // Asking for one: the newest widget this chat has made.
    let made: SurfaceSummary | undefined;
    for (const x of Object.values(s.surfaces))
      if (x.thread_id === threadId && (!made || x.updated_at > made.updated_at)) made = x;
    return made;
  });
  const thread = useData((s) => (threadId ? s.threads[threadId] : undefined));
  const load = useData((s) => (threadId ? s.threadLoad[threadId] : undefined));
  const agent = useData((s) => (thread ? s.agents[thread.agent_ids[0] ?? ""] : undefined));
  useEffect(() => {
    if (threadId && load == null) void loadThread(threadId);
  }, [threadId, load]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once the asked-for widget exists, the chat is its chat.
  useEffect(() => {
    if (!surfaceId && surface && threadId) rememberChat(surface.id, threadId);
  }, [surface?.id]);
  if (!thread) return null;
  const title = surface?.title ?? t("widget.askTitle");
  return (
    <Drawer
      key={thread.id}
      className="widgetchat"
      label={t("widget.chatOf", { title })}
      title={title}
      onClose={close}
      actions={
        <>
          {surface && (
            <IconButton
              size="sm"
              label={t("widget.chatNew")}
              icon={<Icons.RotateCcw size={14} />}
              onClick={() => void restartChat(surface)}
            />
          )}
          <IconButton
            size="sm"
            label={t("widget.chatOpen")}
            icon={<Icons.ExternalLink size={14} />}
            onClick={() => {
              // Opened whole, it is the owner's chat now: kept even with nothing written yet.
              asking.delete(thread.id);
              close();
              go.inboxThread(thread.id);
            }}
          />
        </>
      }
    >
      {surface ? (
        <div className="widgetchat__preview">
          <SurfaceFrame surfaceId={surface.id} maxHeight={420} />
        </div>
      ) : (
        <p className="widgetchat__waiting">
          <Icons.LayoutGrid size={14} />
          {t("widget.askWaiting")}
        </p>
      )}
      <div className="widgetchat__chat">
        {load === "ready" ? <Transcript thread={thread} /> : load !== "error" && <Skeleton height={120} />}
      </div>
      <ChatComposer thread={thread} agent={agent} />
    </Drawer>
  );
}
