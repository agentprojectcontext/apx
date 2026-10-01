import type { Agent, Part, RunState } from "@apx/protocol";
import { AgentAvatar, SubthreadCard, type SubthreadCardProps } from "@apx/ui";
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

export function SubthreadPart({ part, from }: { part: Extract<Part, { type: "subthread" }>; from?: Agent }) {
  const t = useT();
  const target = useData((s) => s.agents[part.agent_id]);
  const st = STATE[part.state];
  const name = target?.name ?? part.agent_id;
  return (
    <SubthreadCard
      avatar={<AgentAvatar name={name} blob={blobOf(target)} size={28} animated={part.state === "working"} />}
      title={part.title}
      subtitle={`${from?.name ?? t("common.agent")} → ${name}`}
      status={st.status}
      statusLabel={t(st.label)}
      summary={part.summary}
      openLabel={t("subthread.open", { name })}
      onOpen={() => go.thread(part.thread_id)}
    />
  );
}
