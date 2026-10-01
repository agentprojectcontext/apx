import type { Agent, EngineStatus, HarnessId } from "@apx/protocol";
import { AgentAvatar, Icons, Menu, type MenuEntry, ProjectTile, SearchField, SegmentedControl } from "@apx/ui";
import { useMemo, useState } from "react";
import { setAgentBrowserProfile } from "../data/actions.ts";
import { agentEngineLabel, engineLabel, setAgentHarness } from "../data/engines.ts";
import { blobOf, DEFAULT_PID, projectInitial, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { SectionHead } from "./SectionHead.tsx";

const HARNESSES: readonly HarnessId[] = ["native", "claude", "codex"];

/** Agentes: which engine runs each agent and which browser profile it uses. */
export function AgentsSection() {
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
      <SectionHead
        title="Agentes"
        lead="Motor: quién corre los turnos de cada agente (por defecto, el que elijas en Motores). Navegador: Compartido usa tus sesiones, Aislado tiene su propio perfil, Incógnito arranca vacío cada vez."
      />
      <SearchField placeholder="Buscar agente" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
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
                  {project?.name ?? (a.kind === "secretary" ? "Super-agente · global" : "Global")}
                </span>
              </span>
              <HarnessPicker agent={a} engines={engines} />
              <SegmentedControl
                size="sm"
                label={`Perfil de ${a.name}`}
                value={a.browser_profile}
                onValueChange={(v) => void setAgentBrowserProfile(a.id, v as Agent["browser_profile"])}
                options={[
                  { value: "shared", label: "Compartido" },
                  { value: "isolated", label: "Aislado" },
                  { value: "incognito", label: "Incógnito" },
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
  const current = agent.harness;
  const check = (on: boolean) => (on ? <Icons.Check /> : <span />);
  const items: MenuEntry[] = [
    { type: "label", label: `Motor de ${agent.name}` },
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
        shortcut: e && !e.installed ? "no instalado" : e && !e.logged_in ? "sin sesión" : undefined,
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
        <button type="button" className="selectbtn" aria-label={`Motor de ${agent.name}`}>
          <span className="selectbtn__text">{agentEngineLabel(current, engines)}</span>
          <Icons.ChevronDown size={12} />
        </button>
      }
    />
  );
}
