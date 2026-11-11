import "./AgentEvent.css";
import type { Agent, Message } from "@apx/protocol";
import { AgentAvatar, Button, Icons, MarkdownView, SubthreadCard } from "@apx/ui";
import type { ReactNode } from "react";
import { useMarkdownLabels } from "../common/useMarkdownLabels.ts";
import { blobOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, nav } from "../shell/nav.ts";
import { answerText, responseOf } from "./agentEvent.ts";
import { failedLine, responseStatus, responseTitle } from "./responseStatus.ts";

/**
 * Reports are events in the holder's chat, never extra conversation participants. A teammate's answer on a task is its
 * card, as a delegation's is; `card`: the chat already shows that card above, so the answer only points at it.
 */
export function AgentEvent({
  message,
  agent,
  asker,
  card,
  children,
}: {
  message: Message;
  agent?: Agent;
  /** The chat's agent: the one that asked. */
  asker?: Agent;
  card?: { card: string; next: boolean };
  children: ReactNode;
}) {
  const t = useT();
  const response = responseOf(message);
  const name = agent?.name ?? t("chat.theAgent");
  if (response && card)
    return card.next ? null : (
      <div className="transcript__answered">
        <Icons.Reply size={13} />
        <span>{t("chat.answeredAbove", { name })}</span>
        <Button size="sm" variant="ghost" onClick={() => nav.set({ focus: `msg:${card.card}` })}>
          {t("chat.seeAnswer")}
        </Button>
      </div>
    );
  if (response) return <AnswerCard message={message} agent={agent} asker={asker} />;
  return (
    <details className="transcript__agent-event" open>
      <summary>
        <Icons.ChevronRight size={14} />
        <Icons.Bot size={14} />
        <span>{t("chat.agentMessage", { name })}</span>
      </summary>
      <div className="transcript__event-body">{children}</div>
    </details>
  );
}

/** A teammate's answer that reached this chat with no card of its own here (asked elsewhere, or before cards). */
function AnswerCard({ message, agent, asker }: { message: Message; agent?: Agent; asker?: Agent }) {
  const t = useT();
  const mdLabels = useMarkdownLabels();
  const response = responseOf(message);
  const project = useData((s) => s.projects.find((p) => p.id === response?.project_id)?.name);
  if (!response) return null;
  const name = agent?.name ?? t("chat.theAgent");
  const st = responseStatus(response);
  const said = message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
  const failed = failedLine(response.failed, t);
  return (
    <SubthreadCard
      avatar={<AgentAvatar name={name} blob={blobOf(agent)} size={24} />}
      title={t(responseTitle(response), { name })}
      subtitle={[`${asker?.name ?? t("common.agent")} → ${name}`, response.title, project].filter(Boolean).join(" · ")}
      status={st.status}
      statusLabel={t(st.label)}
      summary={<MarkdownView source={answerText(said)} size="sm" labels={mdLabels} />}
      meta={failed}
      openLabel={t("subthread.open", { name })}
      moreLabel={t("subthread.more")}
      lessLabel={t("subthread.less")}
      onOpen={() => go.subthread(response.thread_id)}
    />
  );
}
