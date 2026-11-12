import type { Agent, Part } from "@apx/protocol";
import { AgentAvatar, Icons, MarkdownView, SubthreadCard } from "@apx/ui";
import { duration } from "../../common/format.ts";
import { namedMentions } from "../../common/mentionNames.ts";
import { useMarkdownLabels } from "../../common/useMarkdownLabels.ts";
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
export function SubthreadPart({ part, from }: { part: Extract<Part, { type: "subthread" }>; from?: Agent }) {
  const t = useT();
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
      title={namedMentions(part.title, agents, part.agent_id)}
      subtitle={`${askedBy} → ${name}${part.worker ? ` · ${t("subthread.worker")}` : ""}`}
      status={st.status}
      statusLabel={<span title={failed}>{t(st.label)}</span>}
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
