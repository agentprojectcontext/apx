import type { Agent } from "@apx/protocol";
import { AgentAvatar, Tooltip } from "@apx/ui";
import { useMemo } from "react";
import { blobOf, DEFAULT_PID, findProject, type ProjectEntry, teamOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { SubprojectsBlock } from "./SubprojectsBlock.tsx";

type Member = { agent: Agent; from: "own" | "parent" | "everywhere" };

/** The agents that work in a project: its own, its project's (on a subproject) and the global ones, each once. */
export function useProjectMembers(project: ProjectEntry): { members: Member[]; parent: ProjectEntry | undefined } {
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const parent = project.parent ? findProject(projects, project.parent) : undefined;
  const members = useMemo(() => {
    const seen = new Set<string>();
    const add = (list: Agent[], from: Member["from"]) =>
      list.flatMap((agent) => {
        if (seen.has(agent.id)) return [];
        seen.add(agent.id);
        return [{ agent, from }];
      });
    return [
      ...add(teamOf(agents, project.id), "own"),
      ...(parent && !parent.isDefault ? add(teamOf(agents, parent.id), "parent") : []),
      ...(project.isDefault ? [] : add(teamOf(agents, DEFAULT_PID), "everywhere")),
    ];
  }, [agents, project.id, project.isDefault, parent]);
  return { members, parent };
}

function AgentsBlock({ project }: { project: ProjectEntry }) {
  const t = useT();
  const { members, parent } = useProjectMembers(project);
  const open = (m: Member) =>
    m.from === "own"
      ? go.projectTab("team")
      : go.project(m.from === "parent" && parent ? parent.id : DEFAULT_PID, "team");
  const origin = (m: Member) =>
    m.from === "own"
      ? t("projside.own")
      : m.from === "parent"
        ? t("overview.fromParent", { name: parent?.name ?? "" })
        : t("projside.everywhere");
  return (
    <section className="projside__block">
      <h2 className="projside__h">
        <span className="projside__htext">{t("overview.team")}</span>
      </h2>
      {members.length ? (
        members.map((m) => (
          <Tooltip key={m.agent.id} content={t("projside.openAgent", { name: m.agent.name })}>
            {/* ui: a list row (avatar, name, where it comes from), as the design draws it. */}
            <button type="button" className="projside__agent" onClick={() => open(m)}>
              <AgentAvatar name={m.agent.name} blob={blobOf(m.agent)} size={24} animated={false} />
              <span className="projside__agentname">{m.agent.name}</span>
              <span className="projside__agentfrom">{origin(m)}</span>
            </button>
          </Tooltip>
        ))
      ) : (
        <p className="projside__hint">{t("overview.noAgents")}</p>
      )}
    </section>
  );
}

/** A project's subprojects and agents: the right column of its tabs, and part of its overview's summary. */
export function ProjectSideBlocks({ project }: { project: ProjectEntry }) {
  return (
    <>
      <SubprojectsBlock project={project} />
      <AgentsBlock project={project} />
    </>
  );
}
