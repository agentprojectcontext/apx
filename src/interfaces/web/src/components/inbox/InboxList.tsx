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

export function rowKey(row: InboxRow): string {
  return `${row.project_id ?? "global"}::${row.agent_slug}`;
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
      [r.agent_name, r.agent_slug, r.project_name, r.preview]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)));
  }, [rows, q]);

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
