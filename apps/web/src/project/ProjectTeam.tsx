import type { Agent } from "@apx/protocol";
import { AgentAvatar, Button, ContextMenu, IconButton, Icons, Menu, SegmentedControl, Tabs } from "@apx/ui";
import { type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { useCanCall } from "../call/callStatus.ts";
import { AgentModelPicker } from "../config/models/AgentModelPicker.tsx";
import { calls, openCall } from "../data/calls.ts";
import { PROFILE_KEY } from "../data/engines.ts";
import { blobOf, type ProjectEntry, realProjectId, teamOf } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { useOrg } from "../data/org.ts";
import { useData } from "../data/state.ts";
import { updateAgent } from "../data/team.ts";
import { type T, useT } from "../i18n/index.ts";
import { startChat } from "../inbox/NewChatMenu.tsx";
import { MoveAgentDialog } from "../lazy.ts";
import { go } from "../shell/nav.ts";
import { ProjectEmpty } from "./ProjectEmpty.tsx";
import { ProjectOrg } from "./ProjectOrg.tsx";
import { AgentDetail } from "./team/AgentDetail.tsx";
import { DeleteAgentDialog, NewAgentDialog } from "./team/AgentDialogs.tsx";
import { AgentEditor } from "./team/AgentEditor.tsx";
import { ArchivedAgents } from "./team/ArchivedAgents.tsx";
import { type AgentActions, agentMenu } from "./team/agentMenu.tsx";
import { ImportDialog } from "./team/ImportDialog.tsx";
import { teamLead } from "./team/lead.ts";
import { TeamCanvas } from "./team/TeamCanvas.tsx";
import { useTeamInfo } from "./team/useTeamInfo.tsx";

/** The Agents tab: the agents, and beside them the areas and roles (a company's; other kinds are asked to convert). */
export function ProjectAgents({ project }: { project: ProjectEntry }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const [view, setView] = useState<"agents" | "org">("agents");
  const count = useMemo(() => teamOf(agents, project.id).length, [agents, project.id]);
  const areas = useOrg(project.id)?.areas.length ?? 0;
  const switcher = (
    <Tabs
      variant="pill"
      className="team__tabs"
      value={view}
      onValueChange={(v) => setView(v === "org" ? "org" : "agents")}
      items={[
        { value: "agents", label: t("overview.agents"), count },
        { value: "org", label: t("project.tab.org"), count: areas },
      ]}
    />
  );
  return view === "org" ? (
    <ProjectOrg project={project} switcher={switcher} />
  ) : (
    <ProjectTeam project={project} switcher={switcher} />
  );
}

/** Team: the project's agents as an org chart (lead on top) or a list; import, details and models. */
function ProjectTeam({ project, switcher }: { project: ProjectEntry; switcher?: ReactNode }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const [mode, setMode] = useState("tree");
  const [selected, setSelected] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Agent>();
  const [deleting, setDeleting] = useState<Agent>();
  const [moving, setMoving] = useState<Agent>();
  useMoveNotice(t);
  const team = useMemo(() => teamOf(agents, project.id), [agents, project.id]);
  const lead = teamLead(team);
  // Marked, or the head by inference: a sub-team lead stays marked although the project's head is someone else.
  const leads = (a: Agent) => a.id === lead?.id || a.orchestrator === true;
  const { info, live } = useTeamInfo(lead?.id, lead ? leadLabel(lead, t) : "");
  const current = team.find((a) => a.id === selected);
  const org = useOrg(project.id);
  const canCall = useCanCall();
  const actions: AgentActions = {
    onOpen: (a) => {
      setMode("tree");
      setSelected(a.id);
    },
    onEdit: setEditing,
    onChat: (a) => startChat(a, project.id),
    // During a call it goes back to it, as the call button does.
    ...(canCall
      ? {
          onCall: (a: Agent) => {
            const live = calls.get().live ?? calls.get().status?.live;
            if (live) go.inboxThread(live);
            else openCall({ agent: a.id });
          },
        }
      : {}),
    onDelete: setDeleting,
    onMove: setMoving,
    isOrchestrator: (a) => leads(a),
    onOrchestrator: (a) => void updateAgent(a.id, { orchestrator: !leads(a) }),
  };

  return (
    <div className="team">
      <div className="team__head">
        <div className="team__titles">
          {switcher ?? (
            <div className="team__title">
              {t("overview.agents")} <span className="team__count">{team.length}</span>
            </div>
          )}
          <div className="team__note">
            {project.isDefault ? (
              t("team.globalNote")
            ) : (
              <>
                {t("team.definedInBefore")}
                <code>.agent/agents/</code>
                {t("team.definedInAfter")}
              </>
            )}
          </div>
        </div>
        <SegmentedControl
          size="sm"
          label={t("team.view")}
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "tree", label: t("team.tree") },
            { value: "list", label: t("team.list") },
          ]}
        />
        <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setCreating(true)}>
          {t("team.new")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Icons.Download size={14} />}
          onClick={() => setImporting(true)}
        >
          {t("team.import")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Icons.Settings size={14} />}
          onClick={() => go.config("agents")}
        >
          {t("team.enginesProfiles")}
        </Button>
      </div>

      {team.length === 0 ? (
        <ProjectEmpty name={project.name} />
      ) : mode === "list" ? (
        <ul className="team__list" aria-label={t("overview.agents")}>
          {team.map((a) => (
            <AgentRow key={a.id} agent={a} lead={a === lead} actions={actions} />
          ))}
        </ul>
      ) : (
        <div className={current ? "team__board has-detail" : "team__board"}>
          <TeamCanvas
            agents={team}
            leadId={lead?.id}
            info={info}
            live={live}
            selected={selected}
            onOpen={(a) => setSelected(a.id === selected ? undefined : a.id)}
            onChat={(a) => startChat(a, project.id)}
            menu={(a) => agentMenu(a, t, actions)}
            areaName={(slug) => org?.areas.find((x) => x.slug === slug)?.name ?? slug}
          />
          {current && (
            <AgentDetail
              agent={current}
              team={team}
              onClose={() => setSelected(undefined)}
              onChat={() => startChat(current, project.id)}
            />
          )}
        </div>
      )}
      <ArchivedAgents project={realProjectId(project.id) ?? ""} />
      <TeamDialogs
        project={project}
        creating={creating}
        setCreating={setCreating}
        moving={moving}
        setMoving={setMoving}
        editing={editing}
        setEditing={setEditing}
        deleting={deleting}
        setDeleting={setDeleting}
        selected={selected}
        setSelected={setSelected}
      />
      {importing && (
        <ImportDialog
          projectId={project.id}
          kind={project.kind}
          top={lead}
          team={team}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  );
}

function useMoveNotice(t: T) {
  useEffect(() => {
    try {
      const moved = sessionStorage.getItem("apx.agentMoved");
      if (!moved) return;
      sessionStorage.removeItem("apx.agentMoved");
      const { name, destination } = JSON.parse(moved);
      if (typeof name === "string" && typeof destination === "string")
        notify(t("team.move.done", { name, destination }), "info");
    } catch {
      /* A missing notice does not affect the completed move. */
    }
  }, [t]);
}

function TeamDialogs(p: {
  project: ProjectEntry;
  creating: boolean;
  setCreating(v: boolean): void;
  moving?: Agent;
  setMoving(v?: Agent): void;
  editing?: Agent;
  setEditing(v?: Agent): void;
  deleting?: Agent;
  setDeleting(v?: Agent): void;
  selected?: string;
  setSelected(v?: string): void;
}) {
  return (
    <>
      {p.creating && (
        <NewAgentDialog
          project={p.project}
          onClose={() => p.setCreating(false)}
          onCreated={(a) => {
            p.setCreating(false);
            p.setSelected(a.id);
          }}
        />
      )}
      {p.moving && (
        <Suspense fallback={null}>
          <MoveAgentDialog agent={p.moving} onClose={() => p.setMoving(undefined)} />
        </Suspense>
      )}
      {p.editing && <AgentEditor agent={p.editing} onClose={() => p.setEditing(undefined)} />}
      {p.deleting && (
        <DeleteAgentDialog
          agent={p.deleting}
          onClose={() => {
            if (p.selected === p.deleting?.id) p.setSelected(undefined);
            p.setDeleting(undefined);
          }}
        />
      )}
    </>
  );
}

function leadLabel(agent: Agent, t: T): string {
  return agent.kind === "secretary" ? t("agent.super") : t("team.orchestrator");
}

function AgentRow({ agent, lead, actions }: { agent: Agent; lead: boolean; actions: AgentActions }) {
  const t = useT();
  const items = agentMenu(agent, t, actions);
  return (
    <ContextMenu items={items} render={<li className="team__row" />}>
      <AgentAvatar name={agent.name} blob={blobOf(agent)} size={28} animated={false} />
      <span className="team__cell team__cellname">
        <span className="agentcard__name">
          {agent.name}
          {(lead || agent.orchestrator) && (
            <span className="agentcard__lead">
              <Icons.Crown size={12} />
              {lead ? leadLabel(agent, t) : t("team.subLead")}
            </span>
          )}
        </span>
        <span className="agentcard__slug">{agent.id}</span>
      </span>
      <span className="team__cell team__muted">{agent.role || t("team.noRole")}</span>
      <span className="team__cell team__mono">
        <AgentModelPicker agent={agent} chip />
      </span>
      <span className="team__cell team__subtle">{t(PROFILE_KEY[agent.browser_profile])}</span>
      <Button size="sm" variant="ghost" onClick={() => actions.onChat(agent)}>
        {t("team.chat")}
      </Button>
      <Menu
        align="end"
        trigger={
          <IconButton
            size="sm"
            label={t("team.menu.options", { name: agent.name })}
            icon={<Icons.Ellipsis size={14} />}
          />
        }
        items={items}
      />
    </ContextMenu>
  );
}
