import type { Agent } from "@apx/protocol";
import { AgentAvatar } from "@apx/ui";
import { blobOf } from "../data/identity.ts";

/** The small face of the agent who answers, right before the words that name it (they say who it is). */
export function AnswererFace({ agent, size = 14 }: { agent: Agent | undefined; size?: number }) {
  if (!agent) return null;
  return (
    <span className="answerer" aria-hidden="true">
      <AgentAvatar name={agent.name} blob={blobOf(agent)} size={size} animated={false} />
    </span>
  );
}
