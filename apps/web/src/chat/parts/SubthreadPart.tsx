import type { Agent, Part, RunState } from "@apx/protocol";
import { AgentAvatar, Icons, MarkdownView, SubthreadCard, type SubthreadCardProps } from "@apx/ui";
import { duration } from "../../common/format.ts";
import { blobOf } from "../../data/identity.ts";
import { useData } from "../../data/state.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";

const STATE: Record<RunState, { status: NonNullable<SubthreadCardProps["status"]>; label: MessageKey }> = {
  submitted: { status: "running", label: "run.submitted" },
  working: { status: "running", label: "run.working" },
  "input-required": { status: "waiting", label: "run.waiting" },
  completed: { status: "done", label: "run.done" },
  failed: { status: "failed", label: "run.failed" },
  canceled: { status: "failed", label: "run.canceled" },
};

/** Another agent's (or a worker's) part in this answer: what it was asked, its state and the report it gave back. */
export function SubthreadPart({ part, from }: { part: Extract<Part, { type: "subthread" }>; from?: Agent }) {
  const t = useT();
  const target = useData((s) => s.agents[part.agent_id]);
  const st = STATE[part.state];
  const name = part.worker ?? target?.name ?? part.agent_id;
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
      title={part.title}
      subtitle={`${from?.name ?? t("common.agent")} → ${name}${part.worker ? ` · ${t("subthread.worker")}` : ""}`}
      status={st.status}
      statusLabel={t(st.label)}
      summary={part.summary ? <MarkdownView source={part.summary} size="sm" /> : undefined}
      meta={part.ms !== undefined ? t("subthread.took", { time: duration(part.ms) }) : undefined}
      openLabel={t("subthread.open", { name })}
      moreLabel={t("subthread.more")}
      lessLabel={t("subthread.less")}
      onOpen={() => go.subthread(part.thread_id)}
    />
  );
}
