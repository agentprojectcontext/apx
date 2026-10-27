import type { Agent, Part } from "@apx/protocol";
import { AgentAvatar, Icons, MarkdownView, SubthreadCard } from "@apx/ui";
import { duration } from "../../common/format.ts";
import { useMarkdownLabels } from "../../common/useMarkdownLabels.ts";
import { blobOf } from "../../data/identity.ts";
import { useOwnerName } from "../../data/owner.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";
import { responseStatus, responseTitle } from "../responseStatus.ts";

/** Another agent's (or a worker's) part in this answer: what it was asked, its state and the report it gave back. */
export function SubthreadPart({ part, from }: { part: Extract<Part, { type: "subthread" }>; from?: Agent }) {
  const t = useT();
  const mdLabels = useMarkdownLabels();
  const target = useData((s) => s.agents[part.agent_id] ?? s.former[part.agent_id]);
  const asker = useData((s) => (part.asked_by ? (s.agents[part.asked_by] ?? s.former[part.asked_by]) : undefined));
  const ownerName = useOwnerName();
  const st = responseStatus(part);
  const name = part.worker ?? target?.name ?? part.agent_id;
  // A consult on a task names who asked; a delegation's asker is the message's author.
  const askedBy =
    part.asked_by === "owner" ? ownerName || t("account.you") : (asker?.name ?? from?.name ?? t("common.agent"));
  return (
    <SubthreadCard
      avatar={
        part.worker ? (
          <span className="subthread__worker" title={t("subthread.worker")}>
            <Icons.Bot size={16} />
          </span>
        ) : (
          <AgentAvatar name={name} blob={blobOf(target)} size={28} animated={part.state === "working"} />
        )
      }
      title={part.summary ? t(responseTitle(part), { name }) : part.title}
      subtitle={`${askedBy} → ${name}${part.worker ? ` · ${t("subthread.worker")}` : ""}${part.summary ? ` · ${part.title}` : ""}`}
      status={st.status}
      statusLabel={t(st.label)}
      summary={part.summary ? <MarkdownView source={part.summary} size="sm" labels={mdLabels} /> : undefined}
      meta={part.ms !== undefined ? t("subthread.took", { time: duration(part.ms) }) : undefined}
      openLabel={t("subthread.open", { name })}
      moreLabel={t("subthread.more")}
      lessLabel={t("subthread.less")}
      onOpen={() => go.subthread(part.thread_id)}
    />
  );
}
