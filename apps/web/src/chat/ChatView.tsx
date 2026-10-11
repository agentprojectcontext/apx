import { Button, EmptyState, Icons, Skeleton } from "@apx/ui";
import { useEffect } from "react";
import { usePageVisible } from "../common/useInView.ts";
import { loadThread, markRead } from "../data/actions.ts";
import { threadAgent } from "../data/identity.ts";
import { retryNow } from "../data/live.ts";
import { isNewChat, useNewChat } from "../data/newChat.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { ChatHeader } from "./ChatHeader.tsx";
import { ChatComposer } from "./composer/ChatComposer.tsx";
import { ScreenLive } from "./ScreenLive.tsx";
import { Transcript } from "./Transcript.tsx";

export function ChatView({ wideHeader, compact = false }: { wideHeader: boolean; compact?: boolean }) {
  const t = useT();
  const threadId = useNav((s) => s.threadId);
  const ready = useData((s) => s.ready);
  const stored = useData((s) => (threadId ? s.threads[threadId] : undefined));
  // A new chat is shown from here alone until its first message makes it in the core.
  const fresh = useNewChat(threadId);
  const thread = stored ?? fresh;
  const load = useData((s) => (threadId ? s.threadLoad[threadId] : undefined));
  const agents = useData((s) => s.agents);
  const visible = usePageVisible();
  const offline = useData((s) => s.connection === "offline");

  useEffect(() => {
    if (threadId && ready && load == null && !isNewChat(threadId)) void loadThread(threadId);
  }, [threadId, ready, load]);

  const unread = thread?.unread ?? 0;
  useEffect(() => {
    if (threadId && unread > 0 && visible && load === "ready") void markRead(threadId);
  }, [threadId, unread, visible, load]);

  if (!threadId) {
    return (
      <section className="chat chat--empty">
        <EmptyState size="lg" icon={<Icons.MessageCircle />} title={t("chat.pick.title")}>
          {t("chat.pick.body")}
        </EmptyState>
      </section>
    );
  }
  if (!ready && offline) {
    return (
      <section className="chat chat--empty">
        <EmptyState
          size="lg"
          icon={<Icons.WifiOff />}
          title={t("chat.offline.title")}
          action={
            <Button size="sm" variant="secondary" onClick={retryNow}>
              {t("common.retry")}
            </Button>
          }
        >
          {t("chat.offline.body")}
        </EmptyState>
      </section>
    );
  }
  if (!ready || (!isNewChat(threadId) && load !== "ready" && load !== "error")) return <ChatSkeleton />;
  if (!thread) {
    return (
      <section className="chat chat--empty">
        <EmptyState
          size="lg"
          icon={<Icons.TriangleAlert />}
          title={t("chat.notFound.title")}
          {...(compact
            ? {
                action: (
                  <Button size="sm" variant="secondary" onClick={go.showList}>
                    {t("chat.toList")}
                  </Button>
                ),
              }
            : {})}
        >
          {t("chat.notFound.body")}
        </EmptyState>
      </section>
    );
  }
  const agent = threadAgent(thread, agents);
  const readOnly = thread.kind === "a2a" || thread.parent_id != null;
  return (
    <section className="chat" aria-label={thread.title}>
      <ChatHeader thread={thread} agent={agent} wide={wideHeader} compact={compact} />
      <Transcript thread={thread} />
      {readOnly ? (
        <div className="chat__readonly">
          <Icons.Users size={14} />
          {t("chat.readOnly")}
        </div>
      ) : (
        <ChatComposer key={thread.id} thread={thread} agent={agent} />
      )}
      <ScreenLive />
    </section>
  );
}

function ChatSkeleton() {
  return (
    <section className="chat" aria-busy="true">
      <div className="chat__header">
        <Skeleton shape="circle" width={32} />
        <Skeleton width={180} />
      </div>
      <div className="chat__scroll">
        <div className="transcript">
          <Skeleton width="40%" height={36} shape="block" style={{ alignSelf: "flex-end" }} />
          <Skeleton width="70%" height={64} shape="block" />
          <Skeleton width="55%" height={44} shape="block" />
        </div>
      </div>
    </section>
  );
}
