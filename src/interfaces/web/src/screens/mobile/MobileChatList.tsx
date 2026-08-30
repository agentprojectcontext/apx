import { useEffect, useMemo, useState } from "react";
import { Ellipsis, Search, Settings, Share, ShieldAlert, Smartphone, SquarePen, Users, X } from "lucide-react";
import { installStance, onInstallStateChange, promptInstall } from "../../lib/pwa";
import { NotifyNudge, PrefsDialog } from "../../components/settings/PanelPrefs";
import { InboxRowItem } from "../../components/inbox/InboxRowItem";
import { ChannelFilter } from "../../components/inbox/ChannelFilter";
import { channelEnabledIn, channelsOf } from "../../lib/channels";
import { useChannelPrefs } from "../../hooks/useChannelPrefs";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { InboxRow } from "../../lib/api/inbox";

/**
 * The chat list — one row per agent, most recent first. Agents are loose: there
 * is no per-project grouping here (the project rail is where structure lives).
 * The only group rows are a2a threads, which InboxRowItem draws with a clustered
 * avatar of their participants.
 *
 * The shell stays phone-specific: no module rail or two-pane split, and tapping
 * drills in. Conversation rows share the desktop renderer with touch density.
 */
export function MobileChatList({
  rows, onOpenChat, onNew,
}: {
  rows: InboxRow[];
  onOpenChat: (row: InboxRow) => void;
  /** "New" — open the agent picker to start a chat with anyone, including agents
   *  not in this (web-only) list yet. */
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const androidOptions = typeof window.APXAndroid?.openOptions === "function";
  const view = useChannelPrefs("view");

  // Off the unfiltered rows, so a channel switched off keeps its own chip to
  // come back through — and its count while it is off.
  const channels = useMemo(() => channelsOf(rows), [rows]);
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of rows) {
      const key = row.channel || "other";
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }, [rows]);

  const q = query.trim().toLowerCase();
  const match = (s: string | null | undefined) => !q || String(s || "").toLowerCase().includes(q);
  const shownRows = rows
    .filter((r) => channelEnabledIn(view.prefs, "view", r.channel))
    .filter((r) => match(r.agent_name) || match(r.agent_slug) || match(r.project_name));

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className={cn(
        "shrink-0 border-b border-border px-4 pb-3",
        androidOptions ? "pt-1.5" : "pt-[max(0.75rem,env(safe-area-inset-top))]",
      )}>
        {/* Theme and language are reachable from the screen the phone lands on.
            They used to live only in the desktop panel's Web module, which on a
            phone means leaving the app to change how the app looks. */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{t("inbox.title")}</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onNew}
              aria-label={t("mobile.new_chat")}
              data-testid="mobile-new-chat"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-fg active:bg-accent/60"
            >
              <SquarePen size={19} />
            </button>
            <button
              type="button"
              onClick={() => setPrefsOpen(true)}
              aria-label={t("mobile.prefs")}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-fg active:bg-accent/60"
            >
              <Settings size={19} />
            </button>
            {androidOptions && (
              <button
                type="button"
                onClick={() => window.APXAndroid?.openOptions()}
                aria-label={t("mobile.app_options")}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-fg active:bg-accent/60"
              >
                <Ellipsis size={21} />
              </button>
            )}
          </div>
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
        {/* Which channels this phone wants to see. Telegram starts off here —
            the app is on this very device — and the picker says so ("6 of 11")
            without needing a strip of chips wider than the screen. */}
        {channels.length > 1 && (
          <div className="mt-2 flex items-center gap-2">
            <ChannelFilter
              channels={channels}
              counts={counts}
              enabled={view.enabled}
              onToggle={view.toggle}
              onSetAll={(on) => view.setAll(channels, on)}
              testIdPrefix="mobile-channel"
            />
          </div>
        )}
      </header>

      {/* Both offers live at the top of the screen the phone lands on, for the
          same reason: neither can announce itself. A permission prompt needs a
          real tap to be accepted at all, so the app has to ask first. */}
      <NotifyNudge />
      <InstallRow />

      <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {shownRows.map((row) => (
          <InboxRowItem
            key={`${row.project_id}:${row.agent_slug}:${row.conversation_id ?? ""}`}
            row={row}
            variant="touch"
            onSelect={onOpenChat}
          />
        ))}
        {!shownRows.length && (
          <p className={cn("px-4 py-10 text-center text-sm text-muted-fg")}>
            <Users size={20} className="mx-auto mb-2 opacity-50" />
            {/* An empty list because every channel is off is not an empty
                inbox, and saying so sends someone hunting for a bug. */}
            {rows.length && !q ? t("channels.all_hidden") : t("mobile.empty")}
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
