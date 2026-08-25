import { useRef } from "react";
import { ChatTab } from "../project/ChatTab";
import type { ChatKey } from "../../components/chat/ChatList";
import { selectionFromParam, agentCardUrl } from "./routes";
import type { InboxRow } from "../../lib/api/inbox";

/**
 * The selection this URL asks for, resolved ONCE per URL — not on every render.
 *
 * With no `:session` segment the fallback is the row's own default, which is
 * the INBOX's idea of this agent's latest thread. The inbox moves on its own:
 * it polls every 15s and revalidates on any message anywhere. So Roby answering
 * on Telegram while you were reading the web thread flipped `row.channel`,
 * which changed the selection, which changed the key on the chat below — and
 * remounted the whole thing under you. The thread you were reading swapped for
 * one you never opened, your scroll position and your draft went with it, and a
 * voice note playing at that moment became impossible to stop: a detached
 * <audio> keeps playing, while the play button still on screen belongs to the
 * element that replaced it.
 *
 * A row that moves is news for the LIST. It is not a navigation instruction for
 * the chat you are already inside. Only the URL may move you — which is what
 * picking a session does.
 */
function useResolvedSelection(param: string | undefined, row: InboxRow): ChatKey {
  // Keyed on the chat's identity as well as the param: React reuses this
  // component instance when you go from one agent to another, and a cache keyed
  // on the (absent) session alone would hand the new chat the old one's thread.
  const id = `${row.project_id ?? ""}/${row.agent_slug}/${param ?? ""}`;
  const resolved = useRef<{ id: string; key: ChatKey } | null>(null);
  if (!resolved.current || resolved.current.id !== id) {
    resolved.current = { id, key: selectionFromParam(param, row) };
  }
  return resolved.current.key;
}

/**
 * One chat, full screen.
 *
 * There is nothing here but the chat: the header — back arrow, the agent's
 * face, the session dropdown, the ⋯ menu — is the chat's own, drawn by ChatTab
 * in its compact shape. This screen used to draw a second one beside it, which
 * is how the phone ended up with a session switcher the desktop did not have
 * and with none of the actions the desktop did.
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
  const selection = useResolvedSelection(sessionParamValue, row);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      {/* The real chat surface, not a read-only rendering of it: if you can see
          what an agent said here, you can answer it here. */}
      <ChatTab
        key={JSON.stringify(selection)}
        pid={pid}
        bare
        compact
        hideSidebar
        channelScope="web"
        threadFaces={row.kind === "a2a" ? row.participant_faces : undefined}
        threadTitle={row.kind === "a2a" ? row.agent_name ?? undefined : undefined}
        onOpenInProject={() => window.open(agentCardUrl(row), "_blank", "noopener")}
        onBack={onBack}
        onSelectionChange={onPickSession}
        initialSelection={selection}
      />
    </div>
  );
}
