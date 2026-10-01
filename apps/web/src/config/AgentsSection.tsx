import type { Agent, EngineStatus, HarnessId } from "@apx/protocol";
import { AgentAvatar, Icons, Menu, type MenuEntry, ProjectTile, SearchField, SegmentedControl } from "@apx/ui";
import { useMemo, useState } from "react";
import { setAgentBrowserProfile } from "../data/actions.ts";
import { agentEngineLabel, engineLabel, PROFILE_KEY, setAgentHarness } from "../data/engines.ts";
import { blobOf, DEFAULT_PID, projectInitial, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { SectionHead } from "./SectionHead.tsx";

const HARNESSES: readonly HarnessId[] = ["native", "claude", "codex"];

/** Agents: which engine runs each agent and which browser profile it uses. */
export function AgentsSection() {
  const t = useT();
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const engines = useData((s) => s.engines);
  const [q, setQ] = useState("");
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
      <SectionHead title={t("config.agents")} lead={t("agents.lead")} />
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
              <HarnessPicker agent={a} engines={engines} />
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

function HarnessPicker({ agent, engines }: { agent: Agent; engines: EngineStatus[] }) {
  const t = useT();
  const current = agent.harness;
  const check = (on: boolean) => (on ? <Icons.Check /> : <span />);
  const items: MenuEntry[] = [
    { type: "label", label: t("agents.engineOf", { name: agent.name }) },
    {
      label: agentEngineLabel(undefined, engines),
      icon: check(current == null),
      onSelect: () => void setAgentHarness(agent.id, null),
    },
    { type: "separator" },
    ...HARNESSES.map((h): MenuEntry => {
      const e = engines.find((x) => x.id === h);
      const usable = !e || (e.installed && e.logged_in);
      return {
        label: engineLabel(h, engines),
        icon: check(current === h),
        shortcut: e && !e.installed ? t("engine.notInstalled") : e && !e.logged_in ? t("engine.noSession") : undefined,
        disabled: !usable && current !== h,
        onSelect: () => void setAgentHarness(agent.id, h),
      };
    }),
  ];
  return (
    <Menu
      align="end"
      items={items}
      trigger={
        <button type="button" className="selectbtn" aria-label={t("agents.engineOf", { name: agent.name })}>
          <span className="selectbtn__text">{agentEngineLabel(current, engines)}</span>
          <Icons.ChevronDown size={12} />
        </button>
      }
    />
  );
}
