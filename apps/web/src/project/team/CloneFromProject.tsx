import type { Agent } from "@apx/protocol";
import { AgentAvatar, Button, Checkbox, EmptyState, Icons, ProjectTile, Switch } from "@apx/ui";
import { useMemo } from "react";
import { blobOf, DEFAULT_PID, projectInitial, projectTone, realProjectId } from "../../data/identity.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { teamLead } from "./lead.ts";

/**
 * The other projects' teams, to copy agents from into this one. An agent belongs to one project, so each pick becomes
 * a new agent; `rename` gives the copies new names so the two teams read apart.
 */
export function CloneFromProject({
  projectId,
  picked,
  onToggle,
  rename,
  onRename,
}: {
  projectId: string;
  picked: Set<string>;
  onToggle(ids: string[], on: boolean): void;
  rename: boolean;
  onRename(on: boolean): void;
}) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const here = realProjectId(projectId);
  const groups = useMemo(() => {
    const byProject = new Map<string, Agent[]>();
    for (const a of Object.values(agents)) {
      if (a.kind === "secretary" || a.project_id === here) continue;
      const key = a.project_id ?? DEFAULT_PID;
      byProject.set(key, [...(byProject.get(key) ?? []), a]);
    }
    return [...byProject.entries()]
      .map(([id, list]) => {
        const lead = teamLead(list);
        return {
          id,
          name: id === DEFAULT_PID ? t("team.clone.global") : (projects.find((p) => p.id === id)?.name ?? id),
          lead: lead?.id,
          // The orchestrator first, as on the team's page.
          list: list.sort((a, b) => Number(b === lead) - Number(a === lead) || a.name.localeCompare(b.name)),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [agents, projects, here, t]);

  if (!groups.length)
    return (
      <EmptyState variant="dashed" size="sm" icon={<Icons.Users />}>
        {t("team.clone.empty")}
      </EmptyState>
    );
  return (
    <div className="teamimport">
      <div className="teamimport__rename">
        <Switch size="sm" checked={rename} onCheckedChange={onRename} label={t("team.clone.rename")} />
        <p className="teamimport__teamdesc">{rename ? t("team.clone.renameOn") : t("team.clone.renameOff")}</p>
      </div>
      {groups.map((g) => {
        const ids = g.list.map((a) => a.id);
        const on = ids.filter((id) => picked.has(id)).length;
        return (
          <section key={g.id} className="teamimport__team">
            <header className="teamimport__teamhead">
              <ProjectTile size={16} tone={projectTone(g.id)} initial={projectInitial(g.name)} />
              <div className="teamimport__teamtitles">
                <div className="teamimport__teamname">{g.name}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onToggle(ids, on < ids.length)}>
                {on < ids.length ? t("team.import.selectAll") : t("team.import.clear")}
              </Button>
            </header>
            <ul className="teamimport__members">
              {g.list.map((a) => (
                <li key={a.id} className="teamimport__member">
                  <Checkbox checked={picked.has(a.id)} onCheckedChange={(v) => onToggle([a.id], v)} />
                  <AgentAvatar name={a.name} blob={blobOf(a)} size={20} animated={false} />
                  <span className="teamimport__membername">{a.name}</span>
                  {a.id === g.lead && (
                    <span className="teamimport__leadtag">
                      <Icons.Crown size={12} />
                      {t("team.orchestrator")}
                    </span>
                  )}
                  <span className="teamimport__muted">{a.role}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
