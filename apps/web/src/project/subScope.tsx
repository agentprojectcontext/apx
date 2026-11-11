import { Badge } from "@apx/ui";
import { useMemo } from "react";
import { type ProjectEntry, projectEntries, projectTone, subprojectsOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";

/**
 * What a project's lists cover: the project and, on a project (not a subproject), its subprojects, so what an agent made
 * or learned in a subproject shows in its project too, marked with the subproject's name.
 */
export function useSubScope(project: ProjectEntry): {
  subs: ProjectEntry[];
  subOf: (pid?: string) => ProjectEntry | undefined;
} {
  const projects = useData((s) => s.projects);
  return useMemo(() => {
    const subs = project.parent ? [] : subprojectsOf(projectEntries(projects), project.id);
    return { subs, subOf: (pid?: string) => (pid ? subs.find((p) => p.id === pid) : undefined) };
  }, [projects, project.id, project.parent]);
}

/** The subproject something comes from, in the subproject's own colour. */
export function SubBadge({ project }: { project: ProjectEntry }) {
  const tone = projectTone(project.id);
  return (
    <Badge tone={tone === "ink" ? "neutral" : tone} className="subbadge">
      {project.name}
    </Badge>
  );
}
