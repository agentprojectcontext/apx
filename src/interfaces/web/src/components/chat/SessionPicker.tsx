import { useState } from "react";
import useSWR from "swr";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Conversations } from "../../lib/api";
import { relativeWhen } from "../../lib/when";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { ChatKey, ChatSelectionMeta } from "./ChatList";

/** Where a chat's sessions come from depends on who you are talking to: the
 *  super-agent has channel threads, a project agent has conversation files. */
export interface SessionRow {
  key: ChatKey;
  id: string;
  label: string;
  when: string;
  channel?: string;
  archived?: boolean;
}

/**
 * Every session of one chat, fetched only when someone asks to see them — the
 * list is navigation, not something the chat needs in order to render.
 */
export function useSessionRows(
  pid: string,
  agentSlug: string,
  isSuper: boolean,
  enabled: boolean,
  channelScope?: string,
) {
  return useSWR<SessionRow[]>(
    enabled ? `sessions:${pid}:${agentSlug}:${isSuper}:${channelScope ?? ""}` : null,
    async () => {
      // `channelScope` keeps this switcher in step with the surface it lives on:
      // the inbox and the phone are web-only, so their session list must not
      // offer a Telegram thread you'd never reach from there. Project-first
      // navigation passes nothing and sees every channel.
      const onScope = (ch?: string) => !channelScope || ch === channelScope;
      // Archived ones are asked for HERE and nowhere else: this is the one
      // list whose job is to offer every session back, including the ones put
      // away. The sidebar and the inbox stay clear of them.
      if (isSuper) {
        const threads = await Conversations.threads(pid, true);
        return threads
          .filter((th) => onScope(th.channel))
          .map((th) => ({
            key: { kind: "thread", channel: th.channel, threadId: th.id } as ChatKey,
            id: `${th.channel}:${th.id}`,
            label: th.title || th.id,
            when: th.last_ts || th.started_at || th.id,
            channel: th.channel,
            archived: th.archived,
          }));
      }
      const convs = await Conversations.list(pid, agentSlug, true);
      return convs
        .filter((c) => onScope(c.channel))
        .map((c) => ({
          key: { kind: "conv", agentSlug, convId: c.id } as ChatKey,
          id: c.id,
          label: c.title || c.id,
          when: c.ended_at || c.started_at || c.id,
          channel: c.channel,
          archived: c.archived,
        }));
    },
  );
}

/** The id of the session currently open, in the same spelling `SessionRow.id`
 *  uses — so the open one can be marked in the list. */
export function currentSessionId(selected: ChatKey): string {
  if (selected.kind === "conv") return selected.convId;
  if (selected.kind === "thread") return `${selected.channel}:${selected.threadId}`;
  return "";
}

/**
 * Which thread you are reading, and the way to any of the others.
 *
 * This is the line under the agent's name on every surface. It used to be flat
 * text on the desktop — the date of the thread you were in, with no way to
 * reach the rest without leaving for the sidebar, which the inbox does not
 * have. One control, two frames: the phone shows it as the header's second
 * line, the desktop as the header's subtitle.
 */
export function SessionPicker({
  pid,
  agentSlug,
  isSuper,
  selected,
  label,
  onPick,
  className,
  channelScope,
}: {
  pid: string;
  agentSlug: string;
  isSuper: boolean;
  selected: ChatKey;
  /** What to show when closed — the thread's title, or "new session". */
  label: string;
  onPick: (key: ChatKey, meta?: ChatSelectionMeta) => void;
  className?: string;
  /** Limit the list to one channel (the inbox and the phone pass "web"). */
  channelScope?: string;
}) {
  const current = currentSessionId(selected);
  // `useSWR(null)` is the off switch: the list is fetched the moment someone
  // reaches for it, not on every chat that gets opened. Armed on hover/focus so
  // it is already there by the time the menu paints.
  const [armed, setArmed] = useState(false);
  const sessions = useSessionRows(pid, agentSlug, isSuper, armed, channelScope);
  const rows = sessions.data || [];
  const live = rows.filter((s) => !s.archived);
  const archivedRows = rows.filter((s) => s.archived);

  const renderRow = (s: SessionRow) => (
    <DropdownMenuItem
      key={s.id}
      onClick={() => onPick(s.key, { archived: s.archived, title: s.label, channel: s.channel })}
      className={cn("items-start gap-2", s.id === current && "bg-primary/10", s.archived && "opacity-70")}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{s.label}</span>
        {s.channel && <span className="text-[10px] text-muted-fg">{s.channel}</span>}
      </span>
      <span className="shrink-0 text-[10px] text-muted-fg">{relativeWhen(s.when, t as never)}</span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex min-w-0 max-w-full items-center gap-1 text-[11px] text-muted-fg hover:text-foreground",
          className,
        )}
        aria-label={t("mobile.sessions")}
        onPointerEnter={() => setArmed(true)}
        onFocus={() => setArmed(true)}
        onClick={() => setArmed(true)}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={12} className="shrink-0 transition-transform data-[popup-open]:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="max-h-[60vh] w-72 overflow-y-auto">
        {sessions.isLoading && (
          <p className="px-2 py-2 text-sm text-muted-fg">{t("common.loading")}</p>
        )}
        {live.map(renderRow)}
        {/* Put away, not gone. They sit under their own heading at the bottom so
            the list stays about what you are likely to resume, while the way
            back to an archived thread is still one scroll away. */}
        {archivedRows.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-fg">
                {t("project.chat.archived_group")}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {archivedRows.map(renderRow)}
          </>
        )}
        {sessions.data && !sessions.data.length && (
          <p className="px-2 py-2 text-sm text-muted-fg">{t("mobile.no_sessions")}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
