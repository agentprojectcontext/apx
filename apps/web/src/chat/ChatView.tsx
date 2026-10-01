import { Button, EmptyState, Icons, Skeleton } from "@apx/ui";
import { useEffect } from "react";
import { usePageVisible } from "../common/useInView.ts";
import { loadThread, markRead } from "../data/actions.ts";
import { threadAgent } from "../data/identity.ts";
import { retryNow } from "../data/live.ts";
import { useData } from "../data/state.ts";
import { useNav } from "../shell/nav.ts";
import { ChatComposer } from "./ChatComposer.tsx";
import { ChatHeader } from "./ChatHeader.tsx";
import { Transcript } from "./Transcript.tsx";

export function ChatView({ wideHeader }: { wideHeader: boolean }) {
  const threadId = useNav((s) => s.threadId);
  const ready = useData((s) => s.ready);
  const thread = useData((s) => (threadId ? s.threads[threadId] : undefined));
  const load = useData((s) => (threadId ? s.threadLoad[threadId] : undefined));
  const agents = useData((s) => s.agents);
  const visible = usePageVisible();
  const offline = useData((s) => s.connection === "offline");

  useEffect(() => {
    if (threadId && ready && load == null) void loadThread(threadId);
  }, [threadId, ready, load]);

  const unread = thread?.unread ?? 0;
  useEffect(() => {
    if (threadId && unread > 0 && visible && load === "ready") void markRead(threadId);
  }, [threadId, unread, visible, load]);

  if (!threadId) {
    return (
      <section className="chat chat--empty">
        <EmptyState size="lg" icon={<Icons.MessageCircle />} title="Elegí un chat">
          O empezá uno nuevo con tu super-agente.
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
          title="Sin conexión con el core"
          action={
            <Button size="sm" variant="secondary" onClick={retryNow}>
              Reintentar
            </Button>
          }
        >
          Revisá que el core esté corriendo (apx2 status).
        </EmptyState>
      </section>
    );
  }
  if (!ready || (load !== "ready" && load !== "error")) return <ChatSkeleton />;
  if (!thread) {
    return (
      <section className="chat chat--empty">
        <EmptyState size="lg" icon={<Icons.TriangleAlert />} title="No encontramos este chat">
          Puede que se haya borrado o que el core no esté disponible.
        </EmptyState>
      </section>
    );
  }
  const agent = threadAgent(thread, agents);
  const readOnly = thread.kind === "a2a" || thread.parent_id != null;
  return (
    <section className="chat" aria-label={thread.title}>
      <ChatHeader thread={thread} agent={agent} wide={wideHeader} />
      <Transcript thread={thread} />
      {readOnly ? (
        <div className="chat__readonly">
          <Icons.Users size={14} />
          Conversación entre agentes · solo lectura
        </div>
      ) : (
        <ChatComposer thread={thread} agent={agent} />
      )}
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
