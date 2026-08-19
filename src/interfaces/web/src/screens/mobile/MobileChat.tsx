import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { AgentAvatar, SUPER_AGENT_ICON } from "../../components/agents/AgentAvatar";
import { ChatTab } from "../project/ChatTab";
import type { ChatKey } from "../../components/chat/ChatList";
import { Conversations } from "../../lib/api";
import { selectionFromParam } from "./routes";
import { relativeWhen } from "../../lib/when";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { InboxRow } from "../../lib/api/inbox";

/** Where a chat's sessions come from depends on who you are talking to: the
 *  super-agent has channel threads, a project agent has conversation files. */
interface SessionRow {
  key: ChatKey;
  id: string;
  label: string;
  when: string;
  channel?: string;
}

/**
 * One chat, full screen.
 *
 * The header is the whole navigation: back on the left, the agent's face and
 * name in the middle, and the session line underneath — tapping it opens the
 * session list for THIS chat, which is the thing the desktop inbox could not do
 * without unplugging you from everything else. Picking one swaps the thread
 * without leaving the chat; it does change the URL (replacing, not stacking,
 * so leaving is still one Back) because a thread you are reading has to be a
 * place you can return to.
 */
export function MobileChat({
  row,
  sessionParamValue,
  onBack,
  onPickSession,
}: {
  row: InboxRow;
  /** The `:session` segment of the URL, if any. */
  sessionParamValue?: string;
  onBack: () => void;
  onPickSession: (key: ChatKey) => void;
}) {
  const pid = String(row.project_id ?? 0);
  // The URL is the state. Picking a session navigates, and this reads it back
  // — so a reload, or the phone discarding the tab while you were in another
  // app, reopens the thread you were actually reading.
  const selection = selectionFromParam(sessionParamValue, row);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isSuper = row.kind === "super_agent";
  const face = isSuper
    ? { icon: SUPER_AGENT_ICON, name: row.agent_name || row.agent_slug }
    : { icon: row.agent_icon, emoji: row.agent_emoji, name: row.agent_name || row.agent_slug };

  // Sessions for this chat. Fetched only when the picker opens — the list is
  // navigation, not something the chat needs to render.
  const sessions = useSWR<SessionRow[]>(
    pickerOpen ? `mobile-sessions:${pid}:${row.agent_slug}:${isSuper}` : null,
    async () => {
      if (isSuper) {
        const threads = await Conversations.threads(pid);
        return threads.map((th) => ({
          key: { kind: "thread", channel: th.channel, threadId: th.id } as ChatKey,
          id: `${th.channel}:${th.id}`,
          label: th.title || th.id,
          when: th.last_ts || th.started_at || th.id,
          channel: th.channel,
        }));
      }
      const convs = await Conversations.list(pid, row.agent_slug);
      return convs.map((c) => ({
        key: { kind: "conv", agentSlug: row.agent_slug, convId: c.id } as ChatKey,
        id: c.id,
        label: c.title || c.id,
        when: c.ended_at || c.started_at || c.id,
        channel: c.channel,
      }));
    },
  );

  const currentId =
    selection.kind === "conv" ? selection.convId
    : selection.kind === "thread" ? `${selection.channel}:${selection.threadId}`
    : t("mobile.live_session");

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("mobile.back")}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-fg active:bg-accent/60"
        >
          <ChevronLeft size={22} />
        </button>
        <AgentAvatar {...face} size={36} />
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-[15px] font-semibold leading-tight">
            {row.agent_name || row.agent_slug}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-fg">
            <span className="truncate">{currentId}</span>
            <ChevronDown size={12} className={cn("shrink-0 transition-transform", pickerOpen && "rotate-180")} />
          </span>
        </button>
      </header>

      {/* Session switcher: a sheet over the thread. Picking one replaces the
          URL rather than pushing, so Back leaves the chat instead of walking
          you through every session you looked at. */}
      {pickerOpen && (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-border bg-muted/20">
          <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
            {t("mobile.sessions")}
          </p>
          {sessions.isLoading && <p className="px-4 py-3 text-sm text-muted-fg">{t("common.loading")}</p>}
          {(sessions.data || []).map((s) => {
            const active = s.id === currentId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { onPickSession(s.key); setPickerOpen(false); }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left active:bg-accent/60",
                  active && "bg-primary/10",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px]">{s.label}</span>
                  {s.channel && <span className="text-[11px] text-muted-fg">{s.channel}</span>}
                </span>
                <span className="shrink-0 text-[11px] text-muted-fg">{relativeWhen(s.when, t as never)}</span>
              </button>
            );
          })}
          {sessions.data && !sessions.data.length && (
            <p className="px-4 py-3 text-sm text-muted-fg">{t("mobile.no_sessions")}</p>
          )}
        </div>
      )}

      {/* The real chat surface, not a read-only rendering of it: if you can see
          what an agent said here, you can answer it here. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <ChatTab
          key={JSON.stringify(selection)}
          pid={pid}
          bare
          hideSidebar
          hideHeader
          initialSelection={selection}
        />
      </div>
    </div>
  );
}
