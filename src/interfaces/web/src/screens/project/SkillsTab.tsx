import { useProject } from "../../hooks/useProjects";
import { Loading } from "../../components/ui";
import { SkillsManager } from "../../components/settings/SkillsManager";

// Per-project skills view: the Claude-Desktop-style manager locked to THIS
// project's scope so you can enable/disable and add skills while working in it.
// The base project (pid "0" = super-agent admin) manages the "default" scope.
export function SkillsTab({ pid }: { pid: string }) {
  const { project } = useProject(pid);
  const scope = pid === "0" ? "default" : project?.path;
  if (!scope) return <Loading />;
  return <SkillsManager scope={scope} />;
}
