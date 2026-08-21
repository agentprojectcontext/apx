import { useEffect, useMemo, useState } from "react";
import { Search, Settings, Share, ShieldAlert, Smartphone, Users, X } from "lucide-react";
import { installStance, onInstallStateChange, promptInstall } from "../../lib/pwa";
import { NotifyNudge, PrefsDialog } from "../../components/settings/PanelPrefs";
import { AgentAvatar } from "../../components/agents/AgentAvatar";
import { SUPER_AGENT_ICON } from "../../components/agents/AgentAvatar";
import { InboxRowItem, inboxRowTime } from "../../components/inbox/InboxRowItem";
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
          <AgentAvatar {...faceOf(m)} size={26} />
        </span>
      ))}
      {members.length > 3 && (
        <span
          data-testid="team-extra-avatar"
          className="absolute -bottom-0.5 -right-0.5 z-10 inline-flex size-5 items-center justify-center rounded-full bg-transparent text-[9px] font-semibold text-muted-fg dark:bg-zinc-300 dark:text-zinc-700"
        >
          +{members.length - 3}
        </span>
      )}
    </span>
  );
}

function TeamRowItem({ team, onClick }: { team: TeamRow; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent/60"
    >
      <BlobCluster members={team.members} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-semibold">{team.projectName}</span>
          <span className="shrink-0 text-[11px] text-muted-fg">{inboxRowTime(team.lastActivityAt)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate text-[13px] text-muted-fg">
            {t("mobile.team_members", { count: String(team.members.length) })}
          </span>
        </span>
      </span>
    </button>
  );
}

/**
 * The chat list — one row per agent you have talked to, most recent first,
 * plus a group row per project team.
 *
 * The shell stays phone-specific: no module rail or two-pane split, and tapping
 * drills in. Conversation rows share the desktop renderer with touch density.
 */
export function MobileChatList({
  rows, onOpenChat, onOpenTeam,
}: {
  rows: InboxRow[];
  onOpenChat: (row: InboxRow) => void;
  onOpenTeam: (team: TeamRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const teams = useMemo(() => buildTeams(rows), [rows]);

  const q = query.trim().toLowerCase();
  const match = (s: string | null | undefined) => !q || String(s || "").toLowerCase().includes(q);
  const shownRows = rows.filter((r) => match(r.agent_name) || match(r.agent_slug) || match(r.project_name));
  const shownTeams = q ? teams.filter((tm) => match(tm.projectName)) : teams;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {/* Theme and language are reachable from the screen the phone lands on.
            They used to live only in the desktop panel's Web module, which on a
            phone means leaving the app to change how the app looks. */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{t("inbox.title")}</h1>
          <button
            type="button"
            onClick={() => setPrefsOpen(true)}
            aria-label={t("mobile.prefs")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-fg active:bg-accent/60"
          >
            <Settings size={19} />
          </button>
        </div>
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

      {/* Both offers live at the top of the screen the phone lands on, for the
          same reason: neither can announce itself. A permission prompt needs a
          real tap to be accepted at all, so the app has to ask first. */}
      <NotifyNudge />
      <InstallRow />

      <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {shownTeams.map((team) => (
          <TeamRowItem
            key={`team:${team.projectId}`}
            team={team}
            onClick={() => onOpenTeam(team)}
          />
        ))}
        {shownRows.map((row) => (
          <InboxRowItem
            key={`${row.project_id}:${row.agent_slug}:${row.conversation_id ?? ""}`}
            row={row}
            variant="touch"
            onSelect={onOpenChat}
          />
        ))}
        {!shownRows.length && !shownTeams.length && (
          <p className={cn("px-4 py-10 text-center text-sm text-muted-fg")}>
            <Users size={20} className="mx-auto mb-2 opacity-50" />
            {t("mobile.empty")}
          </p>
        )}
      </div>

      <PrefsDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}


/**
 * "Put this on your home screen" — offered here because this is the screen a
 * phone actually lands on, not buried in the desktop settings.
 *
 * Shown once and dismissible: an install banner that comes back every session
 * is an ad. Nothing is shown at all when the browser cannot install (no secure
 * context) or already has — the row would be a promise we cannot keep.
 */
const INSTALL_DISMISSED = "apx.install.dismissed";

function InstallRow() {
  const [, bump] = useState(0);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(INSTALL_DISMISSED) === "1";
    } catch {
      return false;
    }
  });
  // Chrome fires beforeinstallprompt whenever it likes — usually after this
  // screen has already painted.
  useEffect(() => onInstallStateChange(() => bump((n) => n + 1)), []);

  const stance = installStance();
  if (hidden) return null;
  // `insecure` is shown too, and that is the important one: over plain http on
  // a LAN address Chrome does not expose the service worker API at all, so
  // nothing fires, nothing appears, and the panel looked like it had simply
  // forgotten to offer the install. Silence is the worst possible answer to
  // "why can't I install this" — say what the browser is doing and why.
  if (stance.kind !== "prompt" && stance.kind !== "ios" && stance.kind !== "insecure") return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(INSTALL_DISMISSED, "1");
    } catch {
      /* private mode: it stays gone for this session, which is enough */
    }
  };

  return (
    <div
      className={cn(
        "flex shrink-0 items-start gap-3 border-b border-border px-4 py-3 text-sm",
        stance.kind === "insecure" ? "bg-amber-500/10" : "bg-primary/5",
      )}
    >
      {stance.kind === "prompt" ? (
        <Smartphone size={16} className="shrink-0 text-primary" />
      ) : stance.kind === "ios" ? (
        <Share size={16} className="shrink-0 text-primary" />
      ) : (
        <ShieldAlert size={16} className="shrink-0 text-amber-500" />
      )}
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {stance.kind === "prompt"
          ? t("access.install_sub")
          : stance.kind === "ios"
            ? t("access.install_ios")
            : t("access.install_insecure")}
      </span>
      {stance.kind === "prompt" && (
        <button
          type="button"
          onClick={() => void promptInstall()}
          className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
        >
          {t("access.install_now")}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("common.close")}
        className="shrink-0 rounded p-1 text-muted-fg hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}
