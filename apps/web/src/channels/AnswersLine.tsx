import type { Agent } from "@apx/protocol";
import { useT } from "../i18n/index.ts";
import { AnswererFace } from "./AnswererFace.tsx";

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
