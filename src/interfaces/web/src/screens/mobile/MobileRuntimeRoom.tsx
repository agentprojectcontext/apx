import { useNavigate, useParams } from "react-router-dom";
import { RuntimeRoomView } from "../../components/runtime/RuntimeConversation";
import { CHAT_ROOT } from "./routes";

/**
 * One coding session, full screen, as the chat it is.
 *
 * A route of its own rather than the sessions list with a sheet open, because
 * the two answer different questions about the same session: this one is
 * reached from the list of CONVERSATIONS, and a conversation opens as a
 * conversation — "en el chat, si abro una sesión debe ser en modo chat" (Manu,
 * 2026-09-20). The list keeps its floating detail for the other question.
 */
export function MobileRuntimeRoom() {
  const { pid = "0", id = "" } = useParams();
  const navigate = useNavigate();
  return (
    // The room is `flex-1` inside a COLUMN, and this is that column.
    //
    // Without it `flex-1` resolved against a plain block: the room grew to the
    // height of the whole transcript — 1988px inside an 812px screen — so the
    // composer sat a thousand pixels below the fold and the thread scrolled the
    // page instead of itself. Same failure as the 9193px sheet the day before,
    // and the same lesson: `flex-1` is a claim on a parent's spare height, and
    // a parent that is not a flex container has none to give.
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <RuntimeRoomView
        variant="chat"
        projectId={pid}
        sessionId={id}
        // Back to where you came from, and to the chat list when there is no
        // history to go back to (a notification's deep link opens cold).
        onBack={() => (window.history.length > 1 ? navigate(-1) : navigate(CHAT_ROOT))}
      />
    </div>
  );
}
