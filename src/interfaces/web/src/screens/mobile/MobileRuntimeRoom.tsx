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
    <RuntimeRoomView
      variant="chat"
      projectId={pid}
      sessionId={id}
      // Back to where you came from, and to the chat list when there is no
      // history to go back to (a notification's deep link opens cold).
      onBack={() => (window.history.length > 1 ? navigate(-1) : navigate(CHAT_ROOT))}
    />
  );
}
