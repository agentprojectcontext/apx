import type { Agent } from "@apx/protocol";
import { AgentAvatar, Button, EmptyState, IconButton, Icons, SegmentedControl } from "@apx/ui";
import { useMemo, useState } from "react";
import { agentEngineLabel, engineLabel, PROFILE_LABEL } from "../data/engines.ts";
import { blobOf, type ProjectEntry } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { startChat } from "../inbox/NewChatMenu.tsx";
import { go } from "../shell/nav.ts";
import { teamOf } from "./ProjectOverview.tsx";

// Who sits on top of the hierarchy, in order: an orchestrator, then a CEO, then any "lead".
const LEADS = [/orchestr|orquest/i, /\bceo\b|chief executive/i, /\blead\b/i];

/** Equipo: the project's agents as a hierarchy (lead on top) or a list, with engine and browser profile. */
export function ProjectTeam({ project }: { project: ProjectEntry }) {
  const agents = useData((s) => s.agents);
  const [mode, setMode] = useState("tree");
  const team = useMemo(() => teamOf(agents, project.id), [agents, project.id]);
  const lead =
    team.find((a) => a.kind === "secretary") ??
    LEADS.map((re) => team.find((a) => re.test(`${a.role} ${a.id}`))).find(Boolean);
  const rest = team.filter((a) => a !== lead);

  return (
    <div className="team">
      <div className="team__head">
        <div className="team__titles">
          <div className="team__title">
            Agentes <span className="team__count">{team.length}</span>
          </div>
          <div className="team__note">
            {project.isDefault ? (
              "Agentes globales: trabajan en cualquier proyecto."
            ) : (
              <>
                Definidos en <code>.apc/agents/</code> del proyecto.
              </>
            )}
          </div>
        </div>
        <SegmentedControl
          size="sm"
          label="Vista del equipo"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "tree", label: "Jerarquía" },
            { value: "list", label: "Lista" },
          ]}
        />
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Icons.Settings size={14} />}
          onClick={() => go.config("agents")}
        >
          Motores y perfiles
        </Button>
      </div>

      {team.length === 0 ? (
        <EmptyState variant="dashed" size="lg" icon={<Icons.Users />}>
          Este proyecto todavía no tiene agentes propios. El super-agente trabaja acá desde Default.
        </EmptyState>
      ) : mode === "list" ? (
        <ul className="team__list" aria-label="Agentes">
          {team.map((a) => (
            <AgentRow key={a.id} agent={a} lead={a === lead} projectId={project.id} />
          ))}
        </ul>
      ) : (
        <>
          {lead && (
            <div className="team__top">
              <div className="team__leadcard">
                <AgentCard agent={lead} lead projectId={project.id} />
              </div>
              {rest.length > 0 && <span className="team__connector" />}
            </div>
          )}
          {rest.length > 0 && (
            <div className={lead ? "team__grid has-lead" : "team__grid"}>
              {rest.map((a) => (
                <AgentCard key={a.id} agent={a} projectId={project.id} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Short engine name for chips. Own harness → tinted chip; inherited default → plain chip, explained on hover. */
function useEngine(agent: Agent): { text: string; title: string; own: boolean } {
  const engines = useData((s) => s.engines);
  if (agent.harness) return { text: engineLabel(agent.harness, engines), title: "Motor propio", own: true };
  const def = engines.find((e) => e.default);
  return { text: def?.label ?? "Por defecto", title: agentEngineLabel(undefined, engines), own: false };
}

function AgentCard({ agent, lead = false, projectId }: { agent: Agent; lead?: boolean; projectId: string }) {
  const engine = useEngine(agent);
  return (
    <div className="agentcard">
      <div className="agentcard__top">
        <AgentAvatar name={agent.name} blob={blobOf(agent)} size={32} animated={false} />
        <span className="agentcard__names">
          <span className="agentcard__name">
            {agent.name}
            {lead && (
              <span className="agentcard__lead">{agent.kind === "secretary" ? "Super-agente" : "Orquestador"}</span>
            )}
          </span>
          <span className="agentcard__slug">{agent.id}</span>
        </span>
        <IconButton
          size="sm"
          variant="secondary"
          label={`Chatear con ${agent.name}`}
          icon={<Icons.MessageCircle size={14} />}
          onClick={() => void startChat(agent, projectId)}
        />
      </div>
      <span className="agentcard__role">{agent.role || "Sin rol"}</span>
      <div className="agentcard__foot">
        <span className={engine.own ? "chip chip--mono is-own" : "chip chip--mono"} title={engine.title}>
          {engine.text}
        </span>
        <span className="chip" title="Perfil del navegador">
          <Icons.Globe size={11} />
          {PROFILE_LABEL[agent.browser_profile]}
        </span>
      </div>
    </div>
  );
}

function AgentRow({ agent, lead, projectId }: { agent: Agent; lead: boolean; projectId: string }) {
  const engine = useEngine(agent);
  return (
    <li className="team__row">
      <AgentAvatar name={agent.name} blob={blobOf(agent)} size={28} animated={false} />
      <span className="team__cell team__cellname">
        <span className="agentcard__name">
          {agent.name}
          {lead && (
            <span className="agentcard__lead">{agent.kind === "secretary" ? "Super-agente" : "Orquestador"}</span>
          )}
        </span>
        <span className="agentcard__slug">{agent.id}</span>
      </span>
      <span className="team__cell team__muted">{agent.role || "Sin rol"}</span>
      <span className="team__cell team__mono" title={engine.title}>
        {engine.text}
      </span>
      <span className="team__cell team__subtle">{PROFILE_LABEL[agent.browser_profile]}</span>
      <Button size="sm" variant="ghost" onClick={() => void startChat(agent, projectId)}>
        Chatear
      </Button>
    </li>
  );
}
