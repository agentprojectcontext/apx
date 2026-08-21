import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { InboxRow } from "../../lib/api/inbox";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneChip } from "../../lib/tone";
import { AgentAvatar, AgentAvatarGroup } from "../agents/AgentAvatar";

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

/** Today → time of day; older → date. Same idea as a messaging app. */
function shortTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function InboxList({
  rows,
  selectedKey,
  onSelect,
  action,
}: {
  rows: InboxRow[];
  selectedKey: string | null;
  onSelect: (row: InboxRow) => void;
  action?: React.ReactNode;
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
          const isActive = key === selectedKey;
          const label = row.agent_name || row.agent_slug;
          return (
            <button
              key={key}
              type="button"
              data-testid={`inbox-row-${row.agent_slug}`}
              onClick={() => onSelect(row)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                isActive
                  ? "bg-primary/12 ring-1 ring-inset ring-primary/25"
                  : "hover:bg-accent/60",
              )}
            >
              {/* Same face the thread header and the bubbles draw. a2a group
                  chats wear both participants' faces as a duo instead. */}
              {row.kind === "a2a" && (row.participant_faces?.length || row.participants?.length) ? (
                <AgentAvatarGroup
                  faces={row.participant_faces?.length
                    ? row.participant_faces
                    : (row.participants || []).map((slug) => ({ name: slug }))}
                  size={24}
                  className="mt-0.5"
                />
              ) : (
                <AgentAvatar
                  icon={row.agent_icon}
                  emoji={row.agent_emoji}
                  name={label}
                  size={32}
                  className="mt-0.5"
                />
              )}

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{label}</span>
                  {/* WHAT this agent is, not where it ranks. "principal" said
                      nothing a reader could act on; the only distinction that
                      matters here is super-agent vs a project's own agent. */}
                  {row.kind === "super_agent" ? (
                    <span className={cn("shrink-0 rounded px-1 text-[9px] font-semibold uppercase tracking-wide", toneChip.emerald)}>
                      {t("agents_ui.super_agent_badge")}
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-[10px] text-muted-fg">
                    {shortTime(row.last_activity_at)}
                  </span>
                </span>

                <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-fg">
                  {row.project_name ? <span className="truncate">{row.project_name}</span> : null}
                  {row.channel ? <span className="opacity-70">· {row.channel}</span> : null}
                </span>

                {/* The agent's own last line. Echoing the user's prompt back
                    tells them nothing they do not already know. */}
                <span className="mt-0.5 block truncate text-xs text-muted-fg">
                  {row.preview || t("inbox.no_reply_yet")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
