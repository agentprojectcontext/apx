import type { Agent } from "@apx/protocol";
import { AgentAvatar, Tooltip } from "@apx/ui";
import { blobOf } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";

/** The small face of the agent who answers a chat or an account, before the line that names it. */
export function AnswererFace({ agent, size = 14 }: { agent: Agent | undefined; size?: number }) {
  const t = useT();
  if (!agent) return null;
  const label = t("ch.answersBy", { agent: agent.name });
  return (
    <Tooltip content={label}>
      <span className="answerer" role="img" aria-label={label}>
        <AgentAvatar name={agent.name} blob={blobOf(agent)} size={size} animated={false} />
      </span>
    </Tooltip>
  );
}
