import type { Agent } from "@apx/protocol";
import { AgentAvatar } from "@apx/ui";
import { blobOf } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";

/** The small face of the agent who answers, right before the words that name it (they say who it is). */
export function AnswererFace({ agent, size = 14 }: { agent: Agent | undefined; size?: number }) {
  if (!agent) return null;
  return (
    <span className="answerer" aria-hidden="true">
      <AgentAvatar name={agent.name} blob={blobOf(agent)} size={size} animated={false} />
    </span>
  );
}

/**
 * A line that ends in who answers: what comes first ("Associate", "When called", the account), then the agent's face
 * and "Roby answers". The face starts the part about the agent, so it reads as its own.
 */
export function AnswersLine({
  lead,
  agent,
  text,
  className,
}: {
  lead?: ReadonlyArray<string | undefined>;
  agent: Agent | undefined;
  /** Other words for the agent's part than "{agent} answers". */
  text?: string | undefined;
  className?: string;
}) {
  const t = useT();
  const before = (lead ?? []).filter(Boolean).join(" · ");
  const answers = text ?? (agent ? t("ch.answersBy", { agent: agent.name }) : undefined);
  return (
    <span className={className ? `answers ${className}` : "answers"}>
      {before && <span className="answers__lead">{before}</span>}
      {before && answers && <span className="answers__sep"> · </span>}
      {answers && (
        <span className="answers__who">
          <AnswererFace agent={agent} />
          <span className="answers__name">{answers}</span>
        </span>
      )}
    </span>
  );
}
