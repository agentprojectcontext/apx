import type { SurfaceSummary } from "@apx/protocol";
import { Icons, type MenuEntry } from "@apx/ui";
import { useMemo } from "react";
import { copySurface, setSurfaceFlags } from "../data/actions.ts";
import { projectEntries, realProjectId, teamOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { askForWidget } from "../surfaces/WidgetChat.tsx";

/**
 * The board's "+": the project's own widgets (one already there checked, not addable twice), asking an agent of the
 * project (or the super-agent) for a new one, and copying one from another project onto this board.
 */
export function useBoardMenu(projectId: string, mine: SurfaceSummary[]): MenuEntry[] {
  const t = useT();
  const agents = useData((s) => s.agents);
  const threads = useData((s) => s.threads);
  const projects = useData((s) => s.projects);
  const surfaces = useData((s) => s.surfaces);
  const superAgent = useMemo(() => Object.values(threads).find((th) => th.kind === "home")?.agent_ids[0], [threads]);
  return useMemo(() => {
    const here = realProjectId(projectId);
    const team = teamOf(agents, projectId);
    // The super-agent can always make one, with this project's context; the project's own agents come first.
    const askers = [
      ...team,
      ...(superAgent && agents[superAgent] && !team.some((a) => a.id === superAgent) ? [agents[superAgent]] : []),
    ];
    const elsewhere = projectEntries(projects)
      .filter((p) => p.id !== projectId)
      .map((p) => ({
        project: p,
        widgets: Object.values(surfaces)
          .filter((s) => (realProjectId(p.id) ? s.project_id === p.id : !s.project_id))
          .sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .filter((x) => x.widgets.length);
    return [
      { type: "label", label: t("board.mine") },
      ...(mine.length
        ? mine.map((s) => ({
            label: s.title,
            icon: <Icons.LayoutGrid />,
            checked: s.pinned,
            disabled: s.pinned,
            onSelect: () => void setSurfaceFlags(s.id, { pinned: true }),
          }))
        : [{ label: t("board.none"), disabled: true }]),
      { type: "separator" },
      {
        type: "submenu",
        label: t("board.ask"),
        icon: <Icons.Sparkles />,
        items: askers.length
          ? askers.map((a) => ({
              label: a.id === superAgent ? t("board.askSuper", { name: a.name }) : a.name,
              onSelect: () => void askForWidget(a.id, here),
            }))
          : [{ label: t("board.noAgents"), disabled: true }],
      },
      {
        type: "submenu",
        label: t("board.copy"),
        icon: <Icons.Copy />,
        disabled: !elsewhere.length,
        items: elsewhere.map(({ project, widgets }) => ({
          type: "submenu" as const,
          label: project.name,
          items: widgets.map((w) => ({ label: w.title, onSelect: () => void copySurface(w.id, here, true) })),
        })),
      },
    ];
  }, [t, agents, projects, surfaces, superAgent, projectId, mine]);
}
