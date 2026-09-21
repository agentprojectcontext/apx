import { type ReactNode, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { MobileChatList } from "./MobileChatList";
import { MobileChat } from "./MobileChat";
import { MobileTasks } from "./MobileTasks";
import { MobileCommitments } from "./MobileCommitments";
import { MobileAttention } from "./MobileAttention";
import { MobileAgents } from "./MobileAgents";
import { MobileRuntimes } from "./MobileRuntimes";
import { MobileRuntimeRoom } from "./MobileRuntimeRoom";
import { MobileTabBar } from "./MobileTabBar";
import { NewChatSheet } from "./NewChatSheet";
import { chatPath, findRow, rowPath, runtimeRoomPath, CHAT_ROOT } from "./routes";
import { useInbox } from "../../hooks/useInbox";
import { Loading } from "../../components/ui";
import type { InboxRow } from "../../lib/api/inbox";

/**
 * The phone surface: four tabs, and one chat at a time.
 *
 * The admin panel squeezed into 400px spends a third of the width on a module
 * rail and wraps captions one word per line. This is not that panel made
 * narrower — it is the handful of things you check standing up, each shaped
 * like a phone app: a list you drill into and back out of, one screen at a
 * time, with the session switcher living INSIDE a chat instead of being a
 * second sidebar you have to leave.
 *
 * Four tabs and not more. Chats, tasks, promises and what is waiting on you:
 * the things that are ABOUT you and are true across every project. Everything the panel does that is
 * about a project — routines, code, agents, settings — stays on the desktop
 * route, because a phone is not where you configure anything.
 *
 * Every screen here is a URL (see routes.ts). It used to be `useState`, which
 * a phone punishes: reloading, or coming back to a tab the OS discarded while
 * you were in another app, dropped you on the list with the thread gone.
 */
export function MobileScreen() {
  return (
    <Routes>
      <Route index element={<Navigate to={CHAT_ROOT} replace />} />
      <Route path="chat" element={<Tabbed><ListRoute /></Tabbed>} />
      {/* No tab bar inside a chat: that screen ends in a composer, and a nav
          bar under it is 56px of thumb target where the send button goes. */}
      <Route path="chat/:pid/:slug" element={<ChatRoute />} />
      <Route path="chat/:pid/:slug/:session" element={<ChatRoute />} />
      <Route path="tasks" element={<Tabbed><MobileTasks /></Tabbed>} />
      <Route path="commitments" element={<Tabbed><MobileCommitments /></Tabbed>} />
      <Route path="attention" element={<Tabbed><MobileAttention /></Tabbed>} />
      <Route path="agents" element={<Tabbed><MobileAgents /></Tabbed>} />
      <Route path="runtimes" element={<Tabbed><RuntimesRoute /></Tabbed>} />
      {/* No tab bar: a thread is a place you are IN, and the chat pane has none
          either. The way out is the back button in its header. */}
      <Route path="runtime/:pid/:id" element={<MobileRuntimeRoom />} />
      {/* `/m` itself, and anything unrecognised, is the chat list — not a 404
          screen inside an app whose whole job is a handful of lists. */}
      <Route path="*" element={<Navigate to={CHAT_ROOT} replace />} />
    </Routes>
  );
}

/** The sessions list, with a way back to where it is reached from.
 *
 *  It is not one of the four tabs — the chat list's `>_` is the door — so
 *  nothing in the tab bar lights up on it and nothing in it led anywhere. The
 *  back arrow goes where you came from, and to the chat list when the screen
 *  was opened cold (a notification, a bookmark, the app resuming on it). */
function RuntimesRoute() {
  const navigate = useNavigate();
  return <MobileRuntimes onBack={() => (window.history.length > 1 ? navigate(-1) : navigate(CHAT_ROOT))} />;
}

/** A list screen plus the bar that moves between them. */
function Tabbed({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      <MobileTabBar />
    </div>
  );
}

function ListRoute() {
  const { rows, isLoading, mutate } = useInbox();
  const navigate = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  // WITH the row's own session, or the URL says only "the super-agent" and the
  // chat opens whichever thread is newest — tapping the row labelled WhatsApp
  // landed you in Telegram. The row knows which thread it is; the path has to
  // carry it.
  const openChat = (row: InboxRow) => navigate(rowPath(row));
  if (isLoading) return <Busy />;
  return (
    <>
      <MobileChatList
        rows={rows}
        onOpenChat={openChat}
        onNew={() => setNewOpen(true)}
      />
      <NewChatSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onPick={(row) => {
          setNewOpen(false);
          // Fresh live session — no stored conv yet.
          openChat({ ...row, conversation_id: null, channel: "web" });
        }}
        /* Straight into the room it just opened: the session is already
           running, and a launch that leaves you on the list is a launch you
           have to go find. */
        onRuntimeStarted={(info) => {
          setNewOpen(false);
          void mutate();
          navigate(runtimeRoomPath(info.project_id, info.session_id));
        }}
        onGroupCreated={(info) => {
          void mutate();
          const slug = `group:${info.id}`;
          navigate(
            chatPath(String(info.project_id), slug, {
              kind: "thread",
              channel: "group",
              threadId: info.id,
            }),
          );
        }}
      />
    </>
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
 * Back goes back — to the team you came through, or the list, whichever it was.
 * Except when there is nothing behind: a link opened from Telegram, or the app
 * launched straight into a chat. Then "back" has to mean the list, or it means
 * leaving the app.
 */
function backToList(navigate: ReturnType<typeof useNavigate>) {
  if (window.history.length > 1) navigate(-1);
  else navigate(CHAT_ROOT, { replace: true });
}

function Busy() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loading />
    </div>
  );
}
