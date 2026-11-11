import type { Thread } from "@apx/protocol";
import { AgentAvatar, Button, Icons, PickRow, ProjectTile, Switch, Tabs } from "@apx/ui";
import { useMemo, useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS, isChannelKind } from "../channels/kinds.ts";
import { useChannels } from "../data/channels.ts";
import { blobOf, inProject, nestProjects, projectEntries, projectInitial, projectTone } from "../data/identity.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { clearAll, filterCount, toggleFilter, toggleHiddenChannel, useInboxFilter } from "./inboxFilter.ts";

type Kind = "channels" | "agents" | "projects";

/**
 * What the filter's popover holds, loaded when it first opens: channel accounts to show or hide (and whether their
 * chats go together), agents or projects to pick, and a way to clear them.
 */
export function InboxFilterBody({ threads }: { threads: Thread[] }) {
  const t = useT();
  const agents = useShownAgents();
  const chosen = useInboxFilter((s) => s);
  const hidden = usePrefs((s) => s.inboxHiddenChannels);
  const active = filterCount(chosen) + hidden.length;
  const projects = useData((s) => s.projects);
  const [kind, setKind] = useState<Kind>("channels");
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
    <>
      <Tabs
        variant="pill"
        className="inboxfilter__tabs"
        value={kind}
        onValueChange={(v) => setKind(v === "projects" || v === "agents" ? v : "channels")}
        items={[
          { value: "channels", label: t("inbox.filter.channels") },
          { value: "agents", label: t("inbox.filter.agents") },
          { value: "projects", label: t("inbox.filter.projects") },
        ]}
      />
      <div className="inboxfilter__list">
        {kind === "channels" ? (
          <ChannelRows threads={threads} hidden={hidden} />
        ) : kind === "agents" ? (
          agentRows.map(({ a, count }) => (
            <PickRow
              key={a.id}
              selected={chosen.agents.includes(a.id)}
              leading={<AgentAvatar name={a.name} blob={blobOf(a)} size={20} animated={false} />}
              title={a.name}
              trailing={<FilterMark count={count} on={chosen.agents.includes(a.id)} />}
              onClick={() => toggleFilter("agents", a.id)}
            />
          ))
        ) : (
          projectRows.map(({ p, count }) => (
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
          ))
        )}
      </div>
      {kind === "channels" && <GroupSwitch />}
      {active > 0 && (
        <div className="inboxfilter__foot">
          <Button size="sm" variant="ghost" onClick={clearAll}>
            {t("inbox.filter.clear")}
          </Button>
        </div>
      )}
    </>
  );
}

/** Each channel account with chats here, most chats first: checked ones show in the Inbox, a click hides or shows it. */
function ChannelRows({ threads, hidden }: { threads: Thread[]; hidden: string[] }) {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  const rows = useMemo(() => {
    const n = new Map<string, number>();
    for (const th of threads) if (th.channel?.id) n.set(th.channel.id, (n.get(th.channel.id) ?? 0) + 1);
    return channels
      .map((c) => ({ c, count: n.get(c.id) ?? 0 }))
      .filter(({ c, count }) => count > 0 || hidden.includes(c.id))
      .sort((x, y) => y.count - x.count);
  }, [threads, channels, hidden]);
  if (!rows.length) return <p className="inboxfilter__empty">{t("inbox.filter.noChannels")}</p>;
  return rows.map(({ c, count }) => {
    const kind = isChannelKind(c.type) ? c.type : undefined;
    const shown = !hidden.includes(c.id);
    return (
      <PickRow
        key={c.id}
        muted={!shown}
        leading={kind ? <KindTile kind={kind} /> : <Icons.Send size={14} />}
        title={c.label || (kind ? t(CHANNEL_KINDS[kind].name) : c.id)}
        trailing={<FilterMark count={count} on={shown} />}
        onClick={() => toggleHiddenChannel(c.id)}
      />
    );
  });
}

/** Whether each channel account's chats go together under one row. */
function GroupSwitch() {
  const t = useT();
  const on = usePrefs((s) => s.inboxByChannel);
  return (
    <div className="inboxfilter__group">
      <Switch
        size="sm"
        checked={on}
        onCheckedChange={(v) => setPrefs({ inboxByChannel: v })}
        label={t("inbox.filter.byChannel")}
      />
    </div>
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
