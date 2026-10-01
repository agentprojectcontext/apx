import type { Agent, Part, RunState } from "@apx/protocol";
import { AgentAvatar, SubthreadCard, type SubthreadCardProps } from "@apx/ui";
import { blobOf } from "../../data/identity.ts";
import { useData } from "../../data/state.ts";
import { go } from "../../shell/nav.ts";

const STATE: Record<RunState, { status: NonNullable<SubthreadCardProps["status"]>; label: string }> = {
  submitted: { status: "running", label: "Enviado" },
  working: { status: "running", label: "Trabajando" },
  "input-required": { status: "waiting", label: "Esperando" },
  completed: { status: "done", label: "Listo" },
  failed: { status: "failed", label: "Falló" },
  canceled: { status: "failed", label: "Cancelado" },
};

export function SubthreadPart({ part, from }: { part: Extract<Part, { type: "subthread" }>; from?: Agent }) {
  const target = useData((s) => s.agents[part.agent_id]);
  const st = STATE[part.state];
  const name = target?.name ?? part.agent_id;
  return (
    <SubthreadCard
      avatar={<AgentAvatar name={name} blob={blobOf(target)} size={28} animated={part.state === "working"} />}
      title={part.title}
      subtitle={`${from?.name ?? "Agente"} → ${name}`}
      status={st.status}
      statusLabel={st.label}
      summary={part.summary}
      openLabel={`Abrir conversación con ${name}`}
      onOpen={() => go.thread(part.thread_id)}
    />
  );
}
