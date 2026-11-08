import type { Thread } from "@apx/protocol";
import { AgentAvatar, Button, IconButton, Icons, PickRow, Popover, ProjectTile, Select, Tabs } from "@apx/ui";
import { useMemo, useState } from "react";
import { CHANNEL_KINDS, isChannelKind } from "../channels/kinds.ts";
import { useChannels } from "../data/channels.ts";
import { blobOf, inProject, nestProjects, projectEntries, projectInitial, projectTone } from "../data/identity.ts";
import { type InboxView, setPrefs, usePrefs } from "../data/prefs.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { clearFilter, type FilterKind, filterCount, toggleFilter, useInboxFilter } from "./inboxFilter.ts";

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
  const active = filterCount(chosen);
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
          className={active ? "inboxfilter__btn is-on" : "inboxfilter__btn"}
          label={active ? t("inbox.filter.on", { n: active }) : t("inbox.filter")}
          icon={
            <>
              <Icons.Filter size={16} />
              {active > 0 && (
                <span className="inboxfilter__count" aria-hidden="true">
                  {active}
                </span>
              )}
            </>
          }
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

/** What the Inbox is narrowed to, as chips under the tabs; each one's × takes it out. */
export function InboxFilterChips() {
  const t = useT();
  const chips = useFilterChips();
  if (!chips.length) return null;
  return (
    <div className="inboxfilter__chips">
      {chips.map(({ kind, id, label }) => (
        <Button
          key={`${kind}:${id}`}
          size="sm"
          variant="secondary"
          className="inboxfilter__chip"
          title={t("inbox.filter.remove", { name: label })}
          trailingIcon={<Icons.X size={12} />}
          onClick={() => toggleFilter(kind, id)}
        >
          {label}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={clearFilter}>
        {t("inbox.filter.clearShort")}
      </Button>
    </div>
  );
}

/** Each thing the filter holds with the name the owner knows it by. */
function useFilterChips(): { kind: FilterKind; id: string; label: string }[] {
  const t = useT();
  const agents = useShownAgents();
  const projects = useData((s) => s.projects);
  const engines = useData((s) => s.engines);
  const channels = useChannels((s) => s.channels);
  const chosen = useInboxFilter((s) => s);
  const app = (kind: string) => (isChannelKind(kind) ? t(CHANNEL_KINDS[kind].name) : kind);
  const names: Record<FilterKind, (id: string) => string> = {
    agents: (id) => agents[id]?.name ?? id,
    projects: (id) => projectEntries(projects).find((p) => p.id === id)?.name ?? id,
    accounts: (id) => {
      const channel = channels.find((c) => c.id === id);
      return channel ? channel.label || app(channel.type) : id;
    },
    channels: app,
    engines: (id) => engines.find((e) => e.id === id)?.label ?? id,
  };
  return (Object.keys(names) as FilterKind[]).flatMap((kind) =>
    chosen[kind].map((id) => ({ kind, id, label: names[kind](id) })),
  );
}
