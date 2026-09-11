import { useMemo, useState } from "react";
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
import { threadContact, threadDate } from "../../lib/thread-id";

/** Where a chat's sessions come from depends on who you are talking to: the
 *  super-agent has channel threads, a project agent has conversation files. */
export interface SessionRow {
  key: ChatKey;
  id: string;
  label: string;
  when: string;
  channel?: string;
  /** The day this session is, when it has one — a channel thread's id IS a day.
   *  Every day of one person's WhatsApp is titled with that person's name, so
   *  without this the switcher is a column of identical rows. */
  day?: string;
  archived?: boolean;
}

/**
 * WHICH CONVERSATION the switcher must stay inside.
 *
 * Not a property of the surface — a property of the thread you have open. It
 * was a surface setting (`channelScope`), and both answers that gave were
 * wrong: the inbox passed "web", so opening a WhatsApp thread listed web
 * sessions and the thread you were actually reading was missing from its own
 * switcher; the phone passed nothing to escape that, so opening Rodri's
 * WhatsApp offered every thread APX has — Telegram days, the log, the CLI, and
 * four other people's WhatsApp conversations, all in one menu.
 *
 * A session is "the same conversation, another day". So the scope is the open
 * thread's channel, plus its person where the channel carries several. With no
 * thread open — a live session — there is nothing to be inside yet, and the
 * surface's own channel is the best available answer.
 */
export interface ChatScope {
  channel?: string;
  /** The open thread, so the fetched list can be asked WHO it belongs to. */
  threadId?: string;
  /** The raw contact key in that id, if any. Only a fallback: the daemon's
   *  resolved `contact_person` is what rows are actually compared by, because
   *  one person writes from several addresses. */
  contact?: string;
}

export function chatScope(selected: ChatKey, surfaceChannel?: string): ChatScope {
  if (selected.kind !== "thread") return { channel: surfaceChannel };
  return {
    channel: selected.channel,
    threadId: selected.threadId,
    contact: threadContact(selected.threadId),
  };
}

/** Which PERSON a thread belongs to, in the spelling two threads can be
 *  compared by. The daemon resolves addresses to one key per human; the id
 *  suffix is the fallback for a thread it could not resolve. */
function personOf(th: { contact_person?: string | null; contact?: string; id: string }): string | undefined {
  return th.contact_person || th.contact || threadContact(th.id);
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
  scope: ChatScope = {},
) {
  return useSWR<SessionRow[]>(
    enabled ? `sessions:${pid}:${agentSlug}:${isSuper}:${scope.channel ?? ""}:${scope.contact ?? ""}` : null,
    async () => {
      const onChannel = (ch?: string) => !scope.channel || ch === scope.channel;
      // Archived ones are asked for HERE and nowhere else: this is the one
      // list whose job is to offer every session back, including the ones put
      // away. The sidebar and the inbox stay clear of them.
      if (isSuper) {
        const threads = await Conversations.threads(pid, true);
        const onChan = threads.filter((th) => onChannel(th.channel));
        // WHOSE conversation is open, in the daemon's resolved spelling. Taken
        // from the thread itself rather than from the id in the URL: the URL
        // carries the address the message arrived from, and the same person's
        // other days can carry another of their addresses. Comparing the raw
        // keys shows half a history while looking complete.
        const open = onChan.find((th) => th.id === scope.threadId);
        const person = (open && personOf(open)) || scope.contact;
        return onChan
          // A channel that carries several people, opened on one of them: the
          // other days of THAT conversation, not of everyone who wrote in.
          .filter((th) => !person || personOf(th) === person)
          .map((th) => ({
            key: { kind: "thread", channel: th.channel, threadId: th.id } as ChatKey,
            id: `${th.channel}:${th.id}`,
            label: th.title || th.id,
            when: th.last_ts || th.started_at || threadDate(th.id) || "",
            channel: th.channel,
            day: threadDate(th.id),
            archived: th.archived,
          }));
      }
      const convs = await Conversations.list(pid, agentSlug, true);
      return convs
        .filter((c) => onChannel(c.channel))
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
  /** The channel this SURFACE talks on. Used only while no thread is open — a
   *  live session has no conversation to stay inside yet, and a message sent
   *  from the inbox lands on the web channel. Once a thread is open it is the
   *  thread that decides (see `chatScope`). */
  channelScope?: string;
}) {
  const current = currentSessionId(selected);
  // `useSWR(null)` is the off switch: the list is fetched the moment someone
  // reaches for it, not on every chat that gets opened. Armed on hover/focus so
  // it is already there by the time the menu paints.
  const [armed, setArmed] = useState(false);
  const scope = useMemo(() => chatScope(selected, channelScope), [selected, channelScope]);
  const sessions = useSessionRows(pid, agentSlug, isSuper, armed, scope);
  const rows = sessions.data || [];
  const live = rows.filter((s) => !s.archived);
  const archivedRows = rows.filter((s) => s.archived);

  const renderRow = (s: SessionRow) => (
    <DropdownMenuItem
      key={s.id}
      data-testid={`session-option-${s.id}`}
      onClick={() => onPick(s.key, { archived: s.archived, title: s.label, channel: s.channel })}
      className={cn("items-start gap-2", s.id === current && "bg-primary/10", s.archived && "opacity-70")}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{s.label}</span>
        {/* The day, because on a channel that belongs to one person every
            session is titled with that person's name: scoped to Rodri, the
            list would otherwise be a column of rows all reading "Rodri". */}
        <span className="text-[10px] text-muted-fg">
          {[s.channel, s.day].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-[10px] text-muted-fg">{relativeWhen(s.when, t as never)}</span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="session-picker"
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
