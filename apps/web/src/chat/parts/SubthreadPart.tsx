import type { Agent, Part } from "@apx/protocol";
import { AgentAvatar, Button, Icons, MarkdownView, SubthreadCard, Tooltip } from "@apx/ui";
import { useEffect, useState } from "react";
import { duration } from "../../common/format.ts";
import { namedMentions } from "../../common/mentionNames.ts";
import { useMarkdownLabels } from "../../common/useMarkdownLabels.ts";
import { refreshDelegation } from "../../data/delegation.ts";
import { blobOf } from "../../data/identity.ts";
import { useOwnerName } from "../../data/owner.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";
import { failedLine, responseStatus } from "../responseStatus.ts";
import { useUnfolded } from "../unfolded.ts";

/**
 * Another agent's (or a worker's) part in this answer, delegated or asked on a task: one row with what it was asked,
 * its state and time, that unfolds its answer and the way into its conversation.
 */
export function SubthreadPart({
  part,
  from,
  compact = false,
}: {
  part: Extract<Part, { type: "subthread" }>;
  from?: Agent;
  compact?: boolean;
}) {
  const t = useT();
  const [available, setAvailable] = useState<string>();
  useEffect(() => {
    if (!compact || !part.question) return;
    let active = true;
    void refreshDelegation(part.thread_id).then(
      () => {
        if (active) setAvailable(part.thread_id);
      },
      () => {
        if (active) setAvailable(undefined);
      },
    );
    return () => {
      active = false;
    };
  }, [compact, part.question, part.thread_id]);
  const mdLabels = useMarkdownLabels();
  const target = useData((s) => s.agents[part.agent_id] ?? s.former[part.agent_id]);
  const asker = useData((s) => (part.asked_by ? (s.agents[part.asked_by] ?? s.former[part.asked_by]) : undefined));
  const ownerName = useOwnerName();
  const agents = useData((s) => s.agents);
  const st = responseStatus(part);
  const failed = failedLine(part.failed, t);
  // The owner's own question on a task keeps its answer in view (DECISIONS.md#d-220).
  const [open, setOpen] = useUnfolded(part.thread_id, part.asked_by === "owner");
  const name = part.worker ?? target?.name ?? part.agent_id;
  // A consult on a task names who asked; a delegation's asker is the message's author.
  const askedBy =
    part.asked_by === "owner" ? ownerName || t("account.you") : (asker?.name ?? from?.name ?? t("common.agent"));
  if (compact) {
    const label = (
      <>
        <span className="chan__consult-pair">
          {askedBy} → {target?.name ?? t("common.agent")}
        </span>
        {part.question && <span className="chan__consult-question">{part.question}</span>}
      </>
    );
    if (!part.question || !target || available !== part.thread_id)
      return <p className="chan__note chan__consult-fallback">{label}</p>;
    return (
      <Tooltip content={t("subthread.open", { name })}>
        <Button
          variant="ghost"
          size="sm"
          className="chan__consult-link"
          leadingIcon={<Icons.MessageCircle size={12} />}
          onClick={() => go.subthread(part.thread_id)}
        >
          {label}
        </Button>
      </Tooltip>
    );
  }
  return (
    <SubthreadCard
      avatar={
        part.worker ? (
          <Tooltip content={t("subthread.worker")}>
            <span className="subthread__worker">
              <Icons.Bot size={14} />
            </span>
          </Tooltip>
        ) : (
          <AgentAvatar name={name} blob={blobOf(target)} size={24} animated={part.state === "working"} />
        )
      }
      title={namedMentions(part.title, agents, part.agent_id)}
      subtitle={[
        // Asked by the same agent (a call asking its own super-agent): who asked whom says nothing.
        askedBy === name ? undefined : `${askedBy} → ${name}`,
        part.worker ? t("subthread.worker") : undefined,
      ]
        .filter(Boolean)
        .join(" · ")}
      status={st.status}
      statusLabel={
        <Tooltip content={failed}>
          <span>{t(st.label)}</span>
        </Tooltip>
      }
      time={
        // Its answer waits for the others asked in the same turn: the caller reads them all together.
        part.held
          ? t("subthread.held", { got: String(part.held.got), of: String(part.held.of) })
          : part.ms !== undefined
            ? duration(part.ms)
            : undefined
      }
      summary={part.summary ? <MarkdownView source={part.summary} size="sm" labels={mdLabels} /> : undefined}
      meta={failed}
      open={open}
      onOpenChange={setOpen}
      openLabel={t("subthread.open", { name })}
      onOpen={() => go.subthread(part.thread_id)}
    />
  );
}
