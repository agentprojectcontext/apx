import { useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { MobileChatList } from "./MobileChatList";
import { MobileChat } from "./MobileChat";
import { NewChatSheet } from "./NewChatSheet";
import { chatPath, findRow, pidOf, MOBILE_ROOT } from "./routes";
import { useInbox } from "../../hooks/useInbox";
import { Loading } from "../../components/ui";
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
 *
 * Every screen here is a URL (see routes.ts). It used to be `useState`, which
 * a phone punishes: reloading, or coming back to a tab the OS discarded while
 * you were in another app, dropped you on the list with the thread gone.
 */
export function MobileScreen() {
  return (
    <Routes>
      <Route index element={<ListRoute />} />
      <Route path="chat/:pid/:slug" element={<ChatRoute />} />
      <Route path="chat/:pid/:slug/:session" element={<ChatRoute />} />
      {/* Anything else under /mobile is the list, not a 404 screen inside an
          app whose whole job is one list. */}
      <Route path="*" element={<Navigate to={MOBILE_ROOT} replace />} />
    </Routes>
  );
}

function ListRoute() {
  const { rows, isLoading, mutate } = useInbox();
  const navigate = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  const openChat = (row: InboxRow) => navigate(chatPath(pidOf(row), row.agent_slug));
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
  else navigate(MOBILE_ROOT, { replace: true });
}

function Busy() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loading />
    </div>
  );
}
