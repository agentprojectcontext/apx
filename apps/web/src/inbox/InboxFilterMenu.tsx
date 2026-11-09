import type { Thread } from "@apx/protocol";
import { Button, IconButton, Icons, Popover, Spinner } from "@apx/ui";
import { Suspense } from "react";
import { CHANNEL_KINDS, isChannelKind } from "../channels/kinds.ts";
import { useChannels } from "../data/channels.ts";
import { projectEntries } from "../data/identity.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { InboxFilterBody } from "../lazy.ts";
import { clearFilter, type FilterKind, filterCount, toggleFilter, useInboxFilter } from "./inboxFilter.ts";

/**
 * The Inbox's filter: pick agents or projects (each with how many chats it has here); the chosen ones show as chips
 * under the tabs. Below, how the Chats tab lists them.
 */
export function InboxFilterMenu({ threads }: { threads: Thread[] }) {
  const t = useT();
  const chosen = useInboxFilter((s) => s);
  const active = filterCount(chosen);
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
      <Suspense fallback={<Spinner size={14} />}>
        <InboxFilterBody threads={threads} />
      </Suspense>
    </Popover>
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
