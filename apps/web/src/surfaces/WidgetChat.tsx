import "../styles/panel-parts.css";
import "../styles/widget-chat.css";
import type { SurfaceSummary } from "@apx/protocol";
import { ConfirmDialog, IconButton, Icons, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { ChatComposer } from "../chat/composer/ChatComposer.tsx";
import { refsOf } from "../chat/composer/contextRefs.ts";
import { Transcript } from "../chat/Transcript.tsx";
import { Drawer } from "../common/Drawer.tsx";
import { useAgentOptions } from "../common/pickers/agentOptions.tsx";
import { SearchSelect } from "../common/pickers/SearchSelect.tsx";
import { loadThread } from "../data/actions.ts";
import { attachmentsOf } from "../data/attachmentDrafts.ts";
import { useSlice } from "../data/createStore.ts";
import { draftOf } from "../data/drafts.ts";
import { useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { SurfaceFrame } from "./SurfaceFrame.tsx";
import { asking, close, rememberChat, restartChat } from "./widgetChatActions.ts";
import { widgetChatOpen as open } from "./widgetChatOpen.ts";

/** Mounted with the shell; its strings load the first time a widget's chat opens, never with the first screen. */
export function WidgetChatHost() {
  const threadId = useSlice(open, (s) => s.threadId);
  return threadId ? <WidgetChatWithStrings /> : null;
}

function WidgetChatWithStrings() {
  return usePack("widgetChat") ? <WidgetChat /> : null;
}

/**
 * The open widget's chat, floating over the page like a task: the widget live on top, the conversation and the
 * composer below, so the owner asks for a change and watches it land. Asking for a new one, the widget the chat makes
 * shows there once it exists (and becomes the widget's chat).
 */
function WidgetChat() {
  const t = useT();
  const { surfaceId, threadId, topic } = useSlice(open, (s) => s);
  const surface = useData((s) => {
    if (surfaceId) return s.surfaces[surfaceId];
    if (!threadId || topic) return undefined;
    // Asking for one: the newest widget this chat has made.
    let made: SurfaceSummary | undefined;
    for (const x of Object.values(s.surfaces))
      if (x.thread_id === threadId && (!made || x.updated_at > made.updated_at)) made = x;
    return made;
  });
  const thread = useData((s) => (threadId ? s.threads[threadId] : undefined));
  const load = useData((s) => (threadId ? s.threadLoad[threadId] : undefined));
  const agent = useData((s) => (thread ? s.agents[thread.agent_ids[0] ?? ""] : undefined));
  const agents = useAgentOptions(surface?.project_id, false, "secretary");
  const [switching, setSwitching] = useState(false);
  const [pendingAgent, setPendingAgent] = useState<string>();
  const requestChat = (agentId: string | undefined) => {
    if (!surface || !threadId || !agentId) return;
    const draft = draftOf(threadId);
    const ownDraft = draft.trim() && draft !== t("widget.chatDraft", { title: surface.title });
    if (ownDraft || attachmentsOf(threadId).snapshot().length || refsOf(threadId).some((r) => r.kind !== "widget")) {
      setPendingAgent(agentId);
    } else void startChat(agentId);
  };
  const startChat = async (agentId?: string) => {
    if (!surface || switching) return;
    setSwitching(true);
    try {
      await restartChat(surface, agentId);
    } finally {
      setSwitching(false);
    }
  };
  useEffect(() => {
    if (threadId && load == null) void loadThread(threadId);
  }, [threadId, load]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once the asked-for widget exists, the chat is its chat.
  useEffect(() => {
    if (!surfaceId && surface && threadId) rememberChat(surface.id, threadId);
  }, [surface?.id]);
  if (!thread) return null;
  const title = topic ?? surface?.title ?? t("widget.askTitle");
  return (
    <Drawer
      key={thread.id}
      className="widgetchat"
      label={topic ?? t("widget.chatOf", { title })}
      title={title}
      onClose={close}
      actions={
        <>
          {surface && (
            <IconButton
              size="sm"
              label={t("widget.chatNew")}
              icon={<Icons.RotateCcw size={14} />}
              disabled={switching}
              onClick={() => requestChat(agent?.id)}
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
      {pendingAgent && (
        <ConfirmDialog
          title={t("widget.chatDraftTitle")}
          description={t("widget.chatDraftKeep")}
          confirmLabel={t("widget.chatDraftContinue")}
          cancelLabel={t("widget.chatDraftCancel")}
          closeLabel={t("common.close")}
          danger={false}
          onClose={() => setPendingAgent(undefined)}
          onConfirm={() => startChat(pendingAgent)}
        />
      )}
      {surface && (
        <div className="widgetchat__agent">
          <SearchSelect
            label={t("widget.chatAgent")}
            searchPlaceholder={t("pickers.searchAgent")}
            emptyLabel={t("pickers.noMatch")}
            size="sm"
            value={agent?.id ?? null}
            placeholder={t("widget.chatAgent")}
            options={agents}
            disabled={switching}
            onValueChange={(id) => {
              if (id && id !== agent?.id) requestChat(id);
            }}
          />
          <p role="status">{switching ? t("widget.chatSwitching") : t("widget.chatAgentHint")}</p>
        </div>
      )}
      {surface ? (
        <div className="widgetchat__preview">
          <SurfaceFrame surfaceId={surface.id} maxHeight={420} />
        </div>
      ) : topic ? null : (
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
