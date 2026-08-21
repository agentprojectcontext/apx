import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { MobileChatList, buildTeams, type TeamRow } from "./MobileChatList";
import { MobileChat } from "./MobileChat";
import { chatPath, findRow, pidOf, teamPath, MOBILE_ROOT } from "./routes";
import { InboxRowItem } from "../../components/inbox/InboxRowItem";
import { useInbox } from "../../hooks/useInbox";
import { Loading } from "../../components/ui";
import { t } from "../../i18n";

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
 *
 * Every screen here is a URL (see routes.ts). It used to be `useState`, which
 * a phone punishes: reloading, or coming back to a tab the OS discarded while
 * you were in another app, dropped you on the list with the thread gone.
 */
export function MobileScreen() {
  return (
    <Routes>
      <Route index element={<ListRoute />} />
      <Route path="team/:pid" element={<TeamRoute />} />
      <Route path="chat/:pid/:slug" element={<ChatRoute />} />
      <Route path="chat/:pid/:slug/:session" element={<ChatRoute />} />
      {/* Anything else under /mobile is the list, not a 404 screen inside an
          app whose whole job is one list. */}
      <Route path="*" element={<Navigate to={MOBILE_ROOT} replace />} />
    </Routes>
  );
}

function ListRoute() {
  const { rows, isLoading } = useInbox();
  const navigate = useNavigate();
  if (isLoading) return <Busy />;
  return (
    <MobileChatList
      rows={rows}
      onOpenChat={(row) => navigate(chatPath(pidOf(row), row.agent_slug))}
      onOpenTeam={(team) => navigate(teamPath(team.projectId))}
    />
  );
}

function ChatRoute() {
  const { pid = "", slug = "", session } = useParams();
  const { rows, isLoading } = useInbox();
  const navigate = useNavigate();
  // Wait for the inbox before resolving: a deep link that resolved against an
  // empty list would draw the placeholder name for a moment and then swap it,
  // which reads as the app opening the wrong chat.
  if (isLoading) return <Busy />;
  const row = findRow(rows, pid, slug);
  return (
    <MobileChat
      row={row}
      sessionParamValue={session}
      onBack={() => backToList(navigate)}
      onPickSession={(key) => navigate(chatPath(pid, slug, key), { replace: true })}
    />
  );
}

/**
 * A team is a list of its members' chats — same rows, scoped. Opening one from
 * here still returns HERE, so the group reads as a folder you stepped into
 * rather than a different place.
 */
function TeamRoute() {
  const { pid = "" } = useParams();
  const { rows, isLoading } = useInbox();
  const navigate = useNavigate();
  if (isLoading) return <Busy />;
  const team: TeamRow | undefined = buildTeams(rows).find((x) => x.projectId === pid);
  if (!team) return <Navigate to={MOBILE_ROOT} replace />;
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => backToList(navigate)}
          aria-label={t("mobile.back")}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-fg active:bg-accent/60"
        >
          <ChevronLeft size={22} />
        </button>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold leading-tight">{team.projectName}</span>
          <span className="text-[11px] text-muted-fg">
            {t("mobile.team_members", { count: String(team.members.length) })}
          </span>
        </span>
      </header>
      <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {team.members.map((m) => (
          <li key={m.agent_slug}>
            <InboxRowItem
              row={m}
              variant="touch"
              onSelect={(row) => navigate(chatPath(pidOf(row), row.agent_slug))}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Back goes back — to the team you came through, or the list, whichever it was.
 * Except when there is nothing behind: a link opened from Telegram, or the app
 * launched straight into a chat. Then "back" has to mean the list, or it means
 * leaving the app.
 */
function backToList(navigate: ReturnType<typeof useNavigate>) {
  if (window.history.length > 1) navigate(-1);
  else navigate(MOBILE_ROOT, { replace: true });
}

function Busy() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loading />
    </div>
  );
}
