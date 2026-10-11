import { AgentAvatar, IconButton, Icons, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { ChatComposer } from "../chat/composer/ChatComposer.tsx";
import { Transcript } from "../chat/Transcript.tsx";
import { loadThread, markRead } from "../data/actions.ts";
import { blobOf, threadAgent } from "../data/identity.ts";
import { isNewChat, newChatId, useNewChat } from "../data/newChat.ts";
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
  const stored = useData((s) => s.threads[threadId]);
  const fresh = useNewChat(threadId);
  const thread = stored ?? fresh;
  const load = useData((s) => s.threadLoad[threadId]);
  const agents = useData((s) => s.agents);
  const agent = thread ? threadAgent(thread, agents) : undefined;

  useEffect(() => {
    if (ready && load == null && !isNewChat(threadId)) void loadThread(threadId);
  }, [ready, load, threadId]);
  const unread = thread?.unread ?? 0;
  useEffect(() => {
    if (unread > 0 && load === "ready") void markRead(threadId);
  }, [threadId, unread, load]);

  // Made with its first message (see newChat.ts).
  const startNew = () => {
    const secretary = Object.values(agents).find((a) => a.kind === "secretary");
    if (secretary) setThreadId(newChatId({ agent: secretary.id }));
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
        <IconButton size="sm" label={t("chat.new")} icon={<Icons.SquarePen size={14} />} onClick={startNew} />
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
        {thread && (fresh || load === "ready") ? (
          <Transcript thread={thread} />
        ) : (
          <Skeleton className="quick__skeleton" />
        )}
      </div>
      {thread && <ChatComposer key={thread.id} thread={thread} agent={agent} onMade={setThreadId} />}
    </section>
  );
}
