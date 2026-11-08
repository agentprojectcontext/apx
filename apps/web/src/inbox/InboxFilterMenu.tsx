import type { Thread } from "@apx/protocol";
import { AgentAvatar, Button, IconButton, Icons, PickRow, Popover, ProjectTile, Select, Tabs } from "@apx/ui";
import { useMemo, useState } from "react";
import { blobOf, inProject, nestProjects, projectEntries, projectInitial, projectTone } from "../data/identity.ts";
import { type InboxView, setPrefs, usePrefs } from "../data/prefs.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { clearFilter, toggleFilter, useInboxFilter } from "./inboxFilter.ts";

const VIEWS: readonly InboxView[] = ["list", "tree", "activity", "chats"];

/**
 * The Inbox's filter: pick agents or projects (each with how many chats it has here); the chosen ones show as chips
 * under the tabs. Below, how the Chats tab lists them.
 */
export function InboxFilterMenu({ threads }: { threads: Thread[] }) {
  const t = useT();
  const agents = useShownAgents();
  const projects = useData((s) => s.projects);
  const chosen = useInboxFilter((s) => s);
  const view = usePrefs((s) => s.inboxView);
  const [kind, setKind] = useState<"agents" | "projects">("agents");
  const active = chosen.agents.length + chosen.projects.length;
  const agentRows = useMemo(() => {
    const n = new Map<string, number>();
    for (const th of threads) for (const id of th.agent_ids) n.set(id, (n.get(id) ?? 0) + 1);
    return [...n]
      .flatMap(([id, count]) => {
        const a = agents[id];
        return a ? [{ a, count }] : [];
      })
      .sort((x, y) => y.count - x.count || x.a.name.localeCompare(y.a.name));
  }, [threads, agents]);
  const projectRows = useMemo(
    () =>
      nestProjects(projectEntries(projects)).map((p) => ({
        p,
        count: threads.filter((th) => inProject(th, p.id)).length,
      })),
    [threads, projects],
  );
  return (
    <Popover
      align="end"
      width={300}
      label={t("inbox.filter")}
      className="inboxfilter"
      trigger={
        <IconButton
          label={active ? t("inbox.filter.on", { n: active }) : t("inbox.filter")}
          active={active > 0}
          icon={<Icons.Filter size={16} />}
        />
      }
    >
      <Tabs
        variant="pill"
        className="inboxfilter__tabs"
        value={kind}
        onValueChange={(v) => setKind(v === "projects" ? "projects" : "agents")}
        items={[
          { value: "agents", label: t("inbox.filter.agents") },
          { value: "projects", label: t("inbox.filter.projects") },
        ]}
      />
      <div className="inboxfilter__list">
        {kind === "agents"
          ? agentRows.map(({ a, count }) => (
              <PickRow
                key={a.id}
                selected={chosen.agents.includes(a.id)}
                leading={<AgentAvatar name={a.name} blob={blobOf(a)} size={20} animated={false} />}
                title={a.name}
                trailing={<FilterMark count={count} on={chosen.agents.includes(a.id)} />}
                onClick={() => toggleFilter("agents", a.id)}
              />
            ))
          : projectRows.map(({ p, count }) => (
              <PickRow
                key={p.id}
                className={p.parent ? "inboxfilter__sub" : undefined}
                selected={chosen.projects.includes(p.id)}
                leading={
                  p.parent ? (
                    <Icons.Folder size={14} />
                  ) : (
                    <ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} size={20} />
                  )
                }
                title={p.name}
                trailing={<FilterMark count={count} on={chosen.projects.includes(p.id)} />}
                onClick={() => toggleFilter("projects", p.id)}
              />
            ))}
      </div>
      <div className="inboxfilter__foot">
        <Select
          size="sm"
          label={t("inbox.view")}
          value={view}
          onValueChange={(v) => setPrefs({ inboxView: (VIEWS.find((x) => x === v) ?? "list") as InboxView })}
          options={VIEWS.map((v) => ({ value: v, label: t(`inbox.view.${v}`) }))}
        />
        {active > 0 && (
          <Button size="sm" variant="ghost" onClick={clearFilter}>
            {t("inbox.filter.clear")}
          </Button>
        )}
      </div>
    </Popover>
  );
}

function FilterMark({ count, on }: { count: number; on: boolean }) {
  return (
    <span className="inboxfilter__mark">
      {count}
      <span className="inboxfilter__check">{on && <Icons.Check size={14} />}</span>
    </span>
  );
}

/** The chosen agents and projects as chips under the tabs; each one's × takes it out. */
export function InboxFilterChips() {
  const t = useT();
  const agents = useShownAgents();
  const projects = useData((s) => s.projects);
  const chosen = useInboxFilter((s) => s);
  if (!chosen.agents.length && !chosen.projects.length) return null;
  const name = (pid: string) => projectEntries(projects).find((p) => p.id === pid)?.name ?? pid;
  return (
    <div className="inboxfilter__chips">
      {chosen.agents.map((id) => (
        <Button
          key={`a:${id}`}
          size="sm"
          variant="secondary"
          className="inboxfilter__chip"
          title={t("inbox.filter.remove", { name: agents[id]?.name ?? id })}
          trailingIcon={<Icons.X size={12} />}
          onClick={() => toggleFilter("agents", id)}
        >
          {agents[id]?.name ?? id}
        </Button>
      ))}
      {chosen.projects.map((id) => (
        <Button
          key={`p:${id}`}
          size="sm"
          variant="secondary"
          className="inboxfilter__chip"
          title={t("inbox.filter.remove", { name: name(id) })}
          trailingIcon={<Icons.X size={12} />}
          onClick={() => toggleFilter("projects", id)}
        >
          {name(id)}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={clearFilter}>
        {t("inbox.filter.clearShort")}
      </Button>
    </div>
  );
}
