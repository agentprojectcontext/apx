import { EmptyState, Icons } from "@apx/ui";
import { DEFAULT_PID, teamOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { startChat } from "../inbox/NewChatMenu.tsx";
import { AgentDetail } from "../project/team/AgentDetail.tsx";
import { go, useNav } from "../shell/nav.ts";

/** The agent a chat is with, beside it: the same block as in its team (settings, prompt, routines, Edit). */
export function AgentPanel() {
  const t = useT();
  const id = useNav((s) => s.panelAgent);
  const agents = useData((s) => s.agents);
  const agent = id ? agents[id] : undefined;
  if (!agent)
    return (
      <EmptyState variant="dashed" icon={<Icons.Bot />} title={t("agent.panel.gone")}>
        {t("agent.panel.goneBody")}
      </EmptyState>
    );
  return (
    <AgentDetail
      agent={agent}
      team={teamOf(agents, agent.project_id ?? DEFAULT_PID)}
      inPanel
      onClose={() => go.panel(null)}
      onChat={() => (agent.kind === "secretary" ? go.thread("home") : startChat(agent, agent.project_id))}
    />
  );
}
