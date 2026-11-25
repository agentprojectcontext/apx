import type { Agent } from "@apx/protocol";
import { AgentChip, Tooltip } from "@apx/ui";
import { blobOf } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

/** An engine session an agent opened: who started it, and the way back to that agent's chat (DECISIONS.md#d-274). */
export function StartedBy({ agent, from }: { agent: Agent; from: string }) {
  const t = useT();
  return (
    <Tooltip content={t("engine.startedByOpen", { name: agent.name })}>
      <span className="startedby">
        <AgentChip
          name={t("engine.startedBy", { name: agent.name })}
          blob={blobOf(agent)}
          tone="neutral"
          onClick={() => go.thread(from)}
        />
      </span>
    </Tooltip>
  );
}
