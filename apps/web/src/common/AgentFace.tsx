import type { Agent } from "@apx/protocol";
import { AgentAvatar, Tooltip } from "@apx/ui";
import { blobOf, projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

export function useAgentHint(agent: Agent | undefined, editable = false): string {
  const t = useT();
  const projects = useData((s) => s.projects);
  const base = useData((s) => s.base.name);
  return agent
    ? t(editable ? "agent.editorHint" : "agent.avatarHint", {
        name: agent.name,
        project: agent.project_id ? projectName(projects, agent.project_id) : base,
      })
    : "";
}

/** List avatars explain identity; header avatars also open the existing agent panel. */
export function AgentFace({
  agent,
  size,
  editable = false,
  online = false,
  animated = false,
}: {
  agent: Agent;
  size: number;
  editable?: boolean;
  online?: boolean;
  animated?: boolean;
}) {
  const t = useT();
  const hint = useAgentHint(agent, editable);
  const face = (
    <AgentAvatar
      name={agent.name}
      blob={blobOf(agent)}
      size={size}
      animated={animated}
      status={online ? "online" : undefined}
      statusLabel={t("presence.online")}
    />
  );
  return (
    <Tooltip content={hint}>
      {editable ? (
        <button
          type="button"
          className="chat__agentbtn"
          aria-label={t("agent.openPanel", { name: agent.name })}
          onClick={() => go.agent(agent.id)}
        >
          {face}
        </button>
      ) : (
        <span style={{ display: "inline-flex" }}>{face}</span>
      )}
    </Tooltip>
  );
}
