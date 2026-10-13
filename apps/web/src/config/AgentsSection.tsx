import type { Agent } from "@apx/protocol";
import { AgentAvatar, ProjectTile, SearchField, SegmentedControl } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { setAgentBrowserProfile } from "../data/actions.ts";
import { PROFILE_KEY } from "../data/engines.ts";
import { blobOf, DEFAULT_PID, projectInitial, projectTone } from "../data/identity.ts";
import { loadCatalog, loadModelsConfig } from "../data/models.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ArchivedAgents } from "../project/team/ArchivedAgents.tsx";
import { AgentLimitsBlock } from "./AgentLimitsBlock.tsx";
import { AgentModelPicker } from "./models/AgentModelPicker.tsx";
import { SectionHead, SubHead } from "./SectionHead.tsx";

/** Agents: how far they go on their own and the archived ones first, then which model and browser profile each uses. */
export function AgentsSection() {
  const t = useT();
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const [q, setQ] = useState("");
  useEffect(() => {
    void loadCatalog();
    void loadModelsConfig();
  }, []);
  const list = useMemo(
    () =>
      Object.values(agents)
        .filter((a) => !q || `${a.name} ${a.role} ${a.id}`.toLowerCase().includes(q.toLowerCase()))
        .sort(
          (a, b) =>
            Number(b.kind === "secretary") - Number(a.kind === "secretary") ||
            Number(Boolean(a.project_id)) - Number(Boolean(b.project_id)) ||
            a.name.localeCompare(b.name),
        )
        .slice(0, 120),
    [agents, q],
  );
  return (
    <>
      <SectionHead title={t("config.agents")} />
      <AgentLimitsBlock />
      <ArchivedAgents />
      <SubHead>{t("agents.each")}</SubHead>
      <p className="config__lead">{t("agents.lead")}</p>
      <SearchField placeholder={t("agents.search")} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      <ul className="agentcfg">
        {list.map((a) => {
          const project = projects.find((p) => p.id === a.project_id);
          return (
            <li key={a.id} className="agentcfg__row">
              <AgentAvatar name={a.name} blob={blobOf(a)} size={28} animated={false} />
              <span className="agentcfg__name">
                <b>{a.name}</b>
                <span className="agentcfg__where">
                  <ProjectTile
                    size={12}
                    tone={projectTone(project?.id ?? DEFAULT_PID)}
                    initial={projectInitial(project?.name ?? "Default")}
                  />
                  {project?.name ?? (a.kind === "secretary" ? t("agents.superGlobal") : t("agents.global"))}
                </span>
              </span>
              <AgentModelPicker agent={a} />
              <SegmentedControl
                size="sm"
                label={t("agents.profileOf", { name: a.name })}
                value={a.browser_profile}
                onValueChange={(v) => void setAgentBrowserProfile(a.id, v as Agent["browser_profile"])}
                options={[
                  { value: "shared", label: t(PROFILE_KEY.shared) },
                  { value: "isolated", label: t(PROFILE_KEY.isolated) },
                  { value: "incognito", label: t(PROFILE_KEY.incognito) },
                ]}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}
