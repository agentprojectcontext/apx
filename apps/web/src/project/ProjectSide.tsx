import type { Agent } from "@apx/protocol";
import { useMemo } from "react";
import { DEFAULT_PID, findProject, type ProjectEntry, teamOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";

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
