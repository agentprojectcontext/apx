import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { AgentAvatar } from "../../components/agents/AgentAvatar";
import type { ReactNode } from "react";
import { SUPER_AGENT_ICON } from "../../components/agents/AgentAvatar";
import { relativeWhen } from "../../lib/when";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { InboxRow } from "../../lib/api/inbox";

/** A project with more than one agent that has been talked to: the row reads as
 *  a group, and opening it filters the list to that team. */
export interface TeamRow {
  projectId: string;
  projectName: string;
  members: InboxRow[];
  lastActivityAt: string;
}

/** Teams first, then everyone — the same order a messaging app uses for pinned. */
export function buildTeams(rows: InboxRow[]): TeamRow[] {
  const byProject = new Map<string, InboxRow[]>();
  for (const r of rows) {
    if (r.kind === "super_agent") continue;   // the super-agent is nobody's teammate
    const key = String(r.project_id ?? "");
    if (!key) continue;
    byProject.set(key, [...(byProject.get(key) || []), r]);
  }
  const teams: TeamRow[] = [];
  for (const [projectId, members] of byProject) {
    if (members.length < 2) continue;
    teams.push({
      projectId,
      projectName: members[0].project_name || projectId,
      members,
      lastActivityAt: members.map((m) => m.last_activity_at).sort().reverse()[0] || "",
    });
  }
  return teams.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

function faceOf(row: InboxRow) {
  return row.kind === "super_agent"
    ? { icon: SUPER_AGENT_ICON, name: row.agent_name || row.agent_slug }
    : { icon: row.agent_icon, emoji: row.agent_emoji, name: row.agent_name || row.agent_slug };
}

/** Up to three faces fanned out, the way a group thread reads at a glance. */
function BlobCluster({ members }: { members: InboxRow[] }) {
  const shown = members.slice(0, 3);
  return (
    <span className="relative flex size-12 shrink-0 items-center justify-center">
      {shown.map((m, i) => (
        <span
          key={m.agent_slug}
          className="absolute"
          style={{
            left: `${4 + i * 9}px`,
            top: `${i % 2 === 0 ? 2 : 12}px`,
            zIndex: shown.length - i,
          }}
        >
          <AgentAvatar {...faceOf(m)} size={26} className="ring-2 ring-background" />
        </span>
      ))}
      {members.length > 3 && (
        <span className="absolute -bottom-0.5 -right-0.5 z-10 rounded-full bg-muted px-1 text-[9px] font-semibold text-muted-fg ring-2 ring-background">
          +{members.length - 3}
        </span>
      )}
    </span>
  );
}

function Row({
  face, title, preview, when, badge, onClick,
}: {
  face: ReactNode;
  title: string;
  preview: string;
  when: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent/60"
    >
      {face}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-semibold">{title}</span>
          <span className="shrink-0 text-[11px] text-muted-fg">{when}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate text-[13px] text-muted-fg">{preview}</span>
          {badge && (
            <span className="shrink-0 rounded px-1 text-[10px] uppercase tracking-wide text-muted-fg/70">
              {badge}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/**
 * The chat list — one row per agent you have talked to, most recent first,
 * plus a group row per project team.
 *
 * Deliberately not the desktop inbox in a narrow column: no module rail, no
 * two-pane split, no card chrome. A row fills the width, the avatar is the
 * touch target, and tapping drills IN rather than filling a second pane that
 * would not fit.
 */
export function MobileChatList({
  rows, onOpenChat, onOpenTeam,
}: {
  rows: InboxRow[];
  onOpenChat: (row: InboxRow) => void;
  onOpenTeam: (team: TeamRow) => void;
}) {
  const [query, setQuery] = useState("");
  const teams = useMemo(() => buildTeams(rows), [rows]);

  const q = query.trim().toLowerCase();
  const match = (s: string | null | undefined) => !q || String(s || "").toLowerCase().includes(q);
  const shownRows = rows.filter((r) => match(r.agent_name) || match(r.agent_slug) || match(r.project_name));
  const shownTeams = q ? teams.filter((tm) => match(tm.projectName)) : teams;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="mb-2 text-xl font-semibold">{t("inbox.title")}</h1>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("inbox.search")}
            className="h-10 w-full rounded-full border border-border bg-muted/30 pl-9 pr-3 text-[15px] outline-none placeholder:text-muted-fg focus:border-primary/50"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {shownTeams.map((team) => (
          <Row
            key={`team:${team.projectId}`}
            face={<BlobCluster members={team.members} />}
            title={team.projectName}
            preview={t("mobile.team_members", { count: String(team.members.length) })}
            when={relativeWhen(team.lastActivityAt, t as never)}
            onClick={() => onOpenTeam(team)}
          />
        ))}
        {shownRows.map((row) => (
          <Row
            key={`${row.project_id}:${row.agent_slug}:${row.conversation_id ?? ""}`}
            face={<AgentAvatar {...faceOf(row)} size={48} />}
            title={row.agent_name || row.agent_slug}
            preview={row.preview || t("mobile.no_messages")}
            when={relativeWhen(row.last_activity_at, t as never)}
            badge={row.channel || undefined}
            onClick={() => onOpenChat(row)}
          />
        ))}
        {!shownRows.length && !shownTeams.length && (
          <p className={cn("px-4 py-10 text-center text-sm text-muted-fg")}>
            <Users size={20} className="mx-auto mb-2 opacity-50" />
            {t("mobile.empty")}
          </p>
        )}
      </div>
    </div>
  );
}
