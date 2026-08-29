import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { InboxRow } from "../../lib/api/inbox";
import { t } from "../../i18n";
import { InboxRowItem } from "./InboxRowItem";

/**
 * The conversation rail: every agent as a chat, most recent first.
 *
 * Messaging-app shape rather than a data table, because that is what this is —
 * a list of people-ish things that said something, ordered by when. The
 * previous version was a full-width list of cards that navigated AWAY on
 * click, which meant losing the list to read one row.
 */

/** Display name for a channel heading. Proper nouns mostly, so they read the
 *  same in either locale; anything unknown shows its raw value rather than
 *  being hidden, because a channel nobody named is exactly the one worth
 *  seeing. */
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  web: "Web",
  web_sidebar: "Web · sidebar",
  web_code: "Web · code",
  desktop: "Desktop",
  deck: "Deck",
  code: "Code",
  cli: "CLI",
  api: "API",
  a2a: "Agente ↔ agente",
  group: "Grupos",
  direct: "Direct",
  other: "—",
};

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] || channel;
}

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.agent_name, r.agent_slug, r.project_name, r.preview, r.channel]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)));
  }, [rows, q]);

  // Grouped by channel, groups ordered by their most recent conversation, so a
  // channel that just spoke rises to the top rather than sitting wherever a
  // fixed channel order happened to put it. `rows` already arrives sorted by
  // recency, so first-seen order is recency order.
  const grouped = useMemo(() => {
    const byChannel = new Map<string, InboxRow[]>();
    for (const row of filtered) {
      const key = row.channel || "other";
      const bucket = byChannel.get(key);
      if (bucket) bucket.push(row);
      else byChannel.set(key, [row]);
    }
    return [...byChannel.entries()];
  }, [filtered]);

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

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!filtered.length ? (
          <p className="px-3 py-6 text-center text-xs text-muted-fg">
            {q ? t("inbox.no_match") : t("inbox.empty")}
          </p>
        ) : null}

        {grouped.map(([channel, group]) => (
          <section key={channel} data-testid={`inbox-group-${channel}`}>
            {/* The channel a conversation happened on is part of what it IS —
                a WhatsApp from a contact and a web chat are different things
                even with the same agent — so the list says so instead of
                interleaving them by timestamp alone. */}
            <h3 className="sticky top-0 z-10 bg-bg/95 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-fg backdrop-blur">
              {channelLabel(channel)}
            </h3>
            {group.map((row) => {
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
          </section>
        ))}
      </div>
    </aside>
  );
}
