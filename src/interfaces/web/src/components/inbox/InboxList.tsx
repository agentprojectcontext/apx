import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { InboxRow } from "../../lib/api/inbox";
import { t } from "../../i18n";
import { InboxRowItem } from "./InboxRowItem";
import { ChannelFilter } from "./ChannelFilter";
import { channelEnabledIn, channelsOf } from "../../lib/channels";
import { useChannelPrefs } from "../../hooks/useChannelPrefs";

/**
 * The conversation rail: every agent as a chat, most recent first.
 *
 * Messaging-app shape rather than a data table, because that is what this is —
 * a list of people-ish things that said something, ordered by when. The
 * previous version was a full-width list of cards that navigated AWAY on
 * click, which meant losing the list to read one row.
 */

/** Identity of a row. Channel is part of it: the same agent now appears once
 *  per channel it was talked to on, so keying by agent alone would collide —
 *  React would drop rows and selecting one would highlight its twin. */
export function rowKey(row: InboxRow): string {
  return `${row.project_id ?? "global"}::${row.agent_slug}::${row.channel ?? ""}`;
}

export function InboxList({
  rows,
  selectedKey,
  onSelect,
  action,
  onNew,
}: {
  rows: InboxRow[];
  selectedKey: string | null;
  onSelect: (row: InboxRow) => void;
  action?: React.ReactNode;
  /** Opens the same + Nuevo picker the phone uses (any agent, any project). */
  onNew?: () => void;
}) {
  const [q, setQ] = useState("");
  const view = useChannelPrefs("view");

  // Every channel this install actually has, and how many rows each holds —
  // computed BEFORE the filter, or a channel would vanish from its own switch
  // the moment it was turned off and there would be no way back.
  const channels = useMemo(() => channelsOf(rows), [rows]);
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of rows) {
      const key = row.channel || "other";
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = rows.filter((r) => channelEnabledIn(view.prefs, "view", r.channel));
    if (!needle) return shown;
    return shown.filter((r) =>
      [r.agent_name, r.agent_slug, r.project_name, r.preview, r.channel]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)));
  }, [rows, q, view.prefs]);

  return (
    <aside className="flex w-full shrink-0 flex-col border-r border-border sm:w-72" data-testid="inbox-list">
      {/* Search sits on the same 44px band as the thread header opposite it, so
          the two panes share one horizon line instead of stepping. */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2">
        <div className="relative flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("inbox.search")}
            aria-label={t("inbox.search")}
            className="w-full rounded-lg border border-border bg-muted/50 py-1.5 pl-7 pr-2 text-sm outline-none placeholder:text-muted-fg focus:border-primary/60"
          />
        </div>
        {onNew && (
          <button
            type="button"
            data-testid="inbox-new-chat"
            onClick={onNew}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-accent/60 px-2 py-1 text-[11px] font-medium hover:bg-accent"
          >
            <Plus className="size-3" /> {t("project.chat.list.new")}
          </button>
        )}
        {action}
      </div>

      {/* Which channels this DEVICE wants to see. One picker, not a strip: on a
          real install there are eleven channels and the rail is 288px wide, so
          a chip row ran off the edge and the filters could not be found. */}
      {channels.length > 1 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
          <ChannelFilter
            channels={channels}
            counts={counts}
            enabled={view.enabled}
            onToggle={view.toggle}
            onSetAll={(on) => view.setAll(channels, on)}
            testIdPrefix="inbox-channel"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!filtered.length ? (
          <p className="px-3 py-6 text-center text-xs text-muted-fg">
            {/* Three different silences, and saying the wrong one sends someone
                looking for a bug: nothing matched the search, every channel is
                switched off, or there is genuinely nothing here yet. */}
            {q ? t("inbox.no_match") : rows.length ? t("channels.all_hidden") : t("inbox.empty")}
          </p>
        ) : null}

        {/* One flat list, newest first — the same shape as /m/chat.
            It used to be grouped by channel under sticky headings, and the
            grouping was quietly the enemy of the sort: what you want from an
            inbox is "what happened last", and eleven channel buckets means the
            newest thing on screen depends on which bucket it fell into. The
            channel is still on every row (ChannelTag), where it belongs — it
            says what a conversation IS without deciding where it sits. */}
        {filtered.map((row) => {
          const key = rowKey(row);
          return (
            <InboxRowItem
              key={key}
              row={row}
              selected={key === selectedKey}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </aside>
  );
}
