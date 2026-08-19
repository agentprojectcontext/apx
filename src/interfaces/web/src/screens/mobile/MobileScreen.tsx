import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { MobileChatList, type TeamRow } from "./MobileChatList";
import { MobileChat } from "./MobileChat";
import { AgentAvatar } from "../../components/agents/AgentAvatar";
import { useInbox } from "../../hooks/useInbox";
import { Loading } from "../../components/ui";
import { relativeWhen } from "../../lib/when";
import { t } from "../../i18n";
import type { InboxRow } from "../../lib/api/inbox";

/**
 * The phone surface: chats, and one chat at a time.
 *
 * The admin panel squeezed into 400px spends a third of the width on a module
 * rail and wraps captions one word per line. This is not that panel made
 * narrower — it is the chat half of it, shaped like a messaging app: a list you
 * drill into and back out of, one screen at a time, with the session switcher
 * living INSIDE a chat instead of being a second sidebar you have to leave.
 *
 * Everything else the panel does (projects, routines, code, settings) stays on
 * the desktop route. This is deliberately chat-only.
 */
export function MobileScreen() {
  const { rows, isLoading } = useInbox();
  const [openChat, setOpenChat] = useState<InboxRow | null>(null);
  const [openTeam, setOpenTeam] = useState<TeamRow | null>(null);

  if (isLoading) {
    return <div className="flex h-full items-center justify-center"><Loading /></div>;
  }

  if (openChat) {
    return (
      <MobileChat
        row={openChat}
        onBack={() => setOpenChat(null)}
      />
    );
  }

  // A team is a list of its members' chats — same rows, scoped. Opening one
  // from here still returns HERE, so the group reads as a folder you stepped
  // into rather than a different place.
  if (openTeam) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => setOpenTeam(null)}
            aria-label={t("mobile.back")}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-fg active:bg-accent/60"
          >
            <ChevronLeft size={22} />
          </button>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight">{openTeam.projectName}</span>
            <span className="text-[11px] text-muted-fg">
              {t("mobile.team_members", { count: String(openTeam.members.length) })}
            </span>
          </span>
        </header>
        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {openTeam.members.map((m) => (
            <li key={m.agent_slug}>
              <button
                type="button"
                onClick={() => setOpenChat(m)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent/60"
              >
                <AgentAvatar icon={m.agent_icon} emoji={m.agent_emoji} name={m.agent_name || m.agent_slug} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-semibold">{m.agent_name || m.agent_slug}</span>
                    <span className="shrink-0 text-[11px] text-muted-fg">{relativeWhen(m.last_activity_at, t as never)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted-fg">
                    {m.preview || t("mobile.no_messages")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <MobileChatList
      rows={rows}
      onOpenChat={setOpenChat}
      onOpenTeam={setOpenTeam}
    />
  );
}
