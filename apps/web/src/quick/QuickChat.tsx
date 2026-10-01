import { AgentAvatar, IconButton, Icons, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { ChatComposer } from "../chat/ChatComposer.tsx";
import { Transcript } from "../chat/Transcript.tsx";
import { createThread, loadThread, markRead } from "../data/actions.ts";
import { blobOf, threadAgent } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

/**
 * The quick chat with the super-agent that the desktop app opens from the menu bar (and its shortcut): the Home
 * chat, or a fresh one, in a small window. Same thread, same transcript and composer as the full app.
 */
export function QuickChat() {
  const t = useT();
  const ready = useData((s) => s.ready);
  const [threadId, setThreadId] = useState("home");
  const thread = useData((s) => s.threads[threadId]);
  const load = useData((s) => s.threadLoad[threadId]);
  const agents = useData((s) => s.agents);
  const agent = thread ? threadAgent(thread, agents) : undefined;

  useEffect(() => {
    if (ready && load == null) void loadThread(threadId);
  }, [ready, load, threadId]);
  const unread = thread?.unread ?? 0;
  useEffect(() => {
    if (unread > 0 && load === "ready") void markRead(threadId);
  }, [threadId, unread, load]);

  const fresh = async () => {
    const secretary = Object.values(agents).find((a) => a.kind === "secretary");
    if (!secretary) return;
    setThreadId((await createThread({ agentId: secretary.id })).id);
  };

  return (
    <section className="quick" aria-label={t("quick.title")}>
      <header className="quick__head">
        <AgentAvatar name={agent?.name ?? "APX"} blob={blobOf(agent)} size={28} status="online" />
        <div className="quick__titles">
          <div className="quick__name">{agent?.name ?? "APX"}</div>
          <div className="quick__sub">{threadId === "home" ? t("quick.home") : t("quick.new")}</div>
        </div>
        {threadId !== "home" && (
          <IconButton
            size="sm"
            label={t("quick.backHome")}
            icon={<Icons.ArrowLeft size={14} />}
            onClick={() => setThreadId("home")}
          />
        )}
        <IconButton size="sm" label={t("chat.new")} icon={<Icons.SquarePen size={14} />} onClick={() => void fresh()} />
        {window.apxDesktop?.openMain && (
          <IconButton
            size="sm"
            label={t("quick.openApp")}
            icon={<Icons.ExternalLink size={14} />}
            onClick={() => window.apxDesktop?.openMain?.(threadId)}
          />
        )}
      </header>
      <div className="quick__body">
        {thread && load === "ready" ? <Transcript thread={thread} /> : <Skeleton className="quick__skeleton" />}
      </div>
      {thread && <ChatComposer thread={thread} agent={agent} />}
    </section>
  );
}
