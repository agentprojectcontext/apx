import type { Agent, Part } from "@apx/protocol";
import { AgentAvatar, Icons, MarkdownView, SubthreadCard } from "@apx/ui";
import { duration } from "../../common/format.ts";
import { useMarkdownLabels } from "../../common/useMarkdownLabels.ts";
import { blobOf } from "../../data/identity.ts";
import { useOwnerName } from "../../data/owner.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";
import { failedLine, responseStatus, responseTitle } from "../responseStatus.ts";

/**
 * Another agent's (or a worker's) part in this answer: what it was asked, its state and the report it gave back. A
 * teammate an agent asked on a task is only its row.
 */
export function SubthreadPart({ part, from }: { part: Extract<Part, { type: "subthread" }>; from?: Agent }) {
  const t = useT();
  const mdLabels = useMarkdownLabels();
  const target = useData((s) => s.agents[part.agent_id] ?? s.former[part.agent_id]);
  const asker = useData((s) => (part.asked_by ? (s.agents[part.asked_by] ?? s.former[part.asked_by]) : undefined));
  const ownerName = useOwnerName();
  const st = responseStatus(part);
  // Its answer waits for the others asked in the same turn: the caller reads them all together.
  const meta = [
    failedLine(part.failed, t),
    part.ms !== undefined ? t("subthread.took", { time: duration(part.ms) }) : undefined,
    part.held ? t("subthread.held", { got: String(part.held.got), of: String(part.held.of) }) : undefined,
  ].filter(Boolean);
  const name = part.worker ?? target?.name ?? part.agent_id;
  // A consult on a task names who asked; a delegation's asker is the message's author.
  const askedBy =
    part.asked_by === "owner" ? ownerName || t("account.you") : (asker?.name ?? from?.name ?? t("common.agent"));
  // One agent asking another on a task is one closed row, as a delegation at work is: who asked whom and what. Its
  // answer and its steps are in its conversation, which the row opens. The owner's own question keeps its answer shown.
  if (part.asked_by !== undefined && part.asked_by !== "owner")
    return (
      <SubthreadCard
        avatar={<AgentAvatar name={name} blob={blobOf(target)} size={24} animated={part.state === "working"} />}
        title={part.title}
        subtitle={`${askedBy} → ${name}`}
        status={st.status}
        statusLabel={<span title={failedLine(part.failed, t)}>{t(st.label)}</span>}
        openLabel={t("subthread.open", { name })}
        onOpen={() => go.subthread(part.thread_id)}
      />
    );
  return (
    <SubthreadCard
      avatar={
        part.worker ? (
          <span className="subthread__worker" title={t("subthread.worker")}>
            <Icons.Bot size={14} />
          </span>
        ) : (
          <AgentAvatar name={name} blob={blobOf(target)} size={24} animated={part.state === "working"} />
        )
      }
      title={part.summary ? t(responseTitle(part), { name }) : part.title}
      subtitle={`${askedBy} → ${name}${part.worker ? ` · ${t("subthread.worker")}` : ""}${part.summary ? ` · ${part.title}` : ""}`}
      status={st.status}
      statusLabel={t(st.label)}
      summary={part.summary ? <MarkdownView source={part.summary} size="sm" labels={mdLabels} /> : undefined}
      meta={meta.length ? meta.join(" · ") : undefined}
      openLabel={t("subthread.open", { name })}
      moreLabel={t("subthread.more")}
      lessLabel={t("subthread.less")}
      onOpen={() => go.subthread(part.thread_id)}
    />
  );
}
