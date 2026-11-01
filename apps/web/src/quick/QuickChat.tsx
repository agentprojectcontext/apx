import "../styles/quick.css";
import { AgentAvatar, Button, IconButton, Icons, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { ChatComposer } from "../chat/composer/ChatComposer.tsx";
import { Transcript } from "../chat/Transcript.tsx";
import { loadThread, markRead } from "../data/actions.ts";
import { blobOf, projectName, threadAgent } from "../data/identity.ts";
import { retryNow } from "../data/live.ts";
import { isNewChat, useNewChat } from "../data/newChat.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { NewChatMenu } from "../inbox/NewChatMenu.tsx";

/**
 * A compact chat for the desktop menu bar and Chrome side panel. Starts at Home; new conversations use the same
 * agent picker, transcript and composer as the full app.
 */
export function QuickChat() {
  const t = useT();
  const ready = useData((s) => s.ready);
  const connection = useData((s) => s.connection);
  const [selection, setSelection] = useState({ id: "home", epoch: 0 });
  const threadId = selection.id;
  const selectThread = (id: string) => setSelection((current) => ({ id, epoch: current.epoch + 1 }));
  const stored = useData((s) => s.threads[threadId]);
  const fresh = useNewChat(threadId);
  const thread = stored ?? fresh;
  const load = useData((s) => s.threadLoad[threadId]);
  const agents = useData((s) => s.agents);
  const agent = thread ? threadAgent(thread, agents) : undefined;
  const projects = useData((s) => s.projects);

  useEffect(() => {
    if (ready && load == null && !isNewChat(threadId)) void loadThread(threadId);
  }, [ready, load, threadId]);
  const unread = thread?.unread ?? 0;
  useEffect(() => {
    if (unread > 0 && load === "ready") void markRead(threadId);
  }, [threadId, unread, load]);

  return (
    <section className="quick" aria-label={t("quick.title")}>
      <header className="quick__head">
        <AgentAvatar
          name={agent?.name ?? "APX"}
          blob={blobOf(agent)}
          size={28}
          status={connection === "connecting" ? "away" : connection}
          statusLabel={t(`connection.${connection}`)}
        />
        <div className="quick__titles">
          <div className="quick__name">{agent?.name ?? "APX"}</div>
          <div className="quick__sub">
            {threadId === "home" ? t("quick.home") : projectName(projects, thread?.project_id)}
          </div>
        </div>
        {threadId !== "home" && (
          <IconButton
            size="sm"
            label={t("quick.backHome")}
            icon={<Icons.ArrowLeft size={14} />}
            onClick={() => selectThread("home")}
          />
        )}
        <NewChatMenu
          projectId={undefined}
          onStart={selectThread}
          disabled={!ready || connection !== "online"}
          trigger={
            <IconButton
              size="sm"
              label={t("chat.new")}
              icon={<Icons.SquarePen size={14} />}
              disabled={!ready || connection !== "online"}
            />
          }
        />
        {window.apxDesktop?.openMain && (
          <IconButton
            size="sm"
            label={t("quick.openApp")}
            icon={<Icons.ExternalLink size={14} />}
            onClick={() => window.apxDesktop?.openMain?.(threadId)}
          />
        )}
      </header>
      {connection === "offline" && (
        <div className="quick__offline" role="status">
          <Icons.WifiOff size={14} />
          <span>{t("composer.offline")}</span>
          <Button size="sm" variant="secondary" onClick={retryNow}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      <div className="quick__body">
        {thread && (fresh || load === "ready") ? (
          <Transcript thread={thread} />
        ) : (
          <Skeleton className="quick__skeleton" />
        )}
      </div>
      {thread && (
        <ChatComposer
          key={`${thread.id}:${selection.epoch}`}
          thread={thread}
          agent={agent}
          onMade={(id) => setSelection((current) => (current.epoch === selection.epoch ? { ...current, id } : current))}
          onNew={selectThread}
          offlineHint={false}
        />
      )}
    </section>
  );
}
