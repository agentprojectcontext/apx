import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EyeOff, Eye, Inbox } from "lucide-react";
import { Button, Empty, Loading } from "../components/ui";
import { Tip } from "../components/ui/tip";
import { InboxList, rowKey } from "../components/inbox/InboxList";
import { ChatTab } from "./project/ChatTab";
import { useInbox } from "../hooks/useInbox";
import { threadMoved } from "../lib/inbox-selection";
import type { InboxRow } from "../lib/api/inbox";
import type { ChatKey } from "../components/chat/ChatList";
import { t } from "../i18n";

/**
 * The agent inbox — every agent as a conversation, most recent first.
 *
 * A SECOND AXIS over the same data, not a replacement for project navigation:
 * this is the conversational way in, the project rail is the structural one.
 *
 * Two panes, like any messaging app: pick on the left, read and reply on the
 * right. The list used to fill the width and NAVIGATE AWAY on click, so
 * reading one conversation meant losing the list — which defeats the point of
 * having an inbox at all. The right pane embeds the real chat surface rather
 * than a read-only rendering of it: if you can see what an agent said, you can
 * answer it there and then.
 *
 * The screen draws NO chrome of its own: no page heading (the breadcrumb
 * already names it), no card (the shell is the card), and no per-selection
 * header (the thread's own header says who you picked). Every one of those was
 * a second frame around something already framed — a title stuck to the top
 * edge, and a card inside a card inside a card.
 */
export function InboxScreen() {
  const navigate = useNavigate();
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const { rows, isLoading } = useInbox(includeEmpty);
  const [selected, setSelected] = useState<InboxRow | null>(null);

  // Open the most recent conversation on arrival. An inbox that lands on an
  // empty pane makes you click twice to see the thing you came for.
  useEffect(() => {
    if (!selected && rows.length) setSelected(rows[0]);
  }, [rows, selected]);

  // Follow the row, not the snapshot of it. The list refreshes underneath as
  // messages arrive, and the same agent can point at a DIFFERENT thread than it
  // did a minute ago — the ledger is a file per day, so the first message after
  // midnight starts a new one. A selection frozen at click time would leave you
  // reading yesterday while today filled up.
  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => rowKey(r) === rowKey(selected));
    if (!fresh) return;
    // What counts as "moved" is in lib/inbox-selection — channel AND id, for a
    // reason worth reading before touching this.
    if (threadMoved(selected, fresh)) setSelected(fresh);
  }, [rows, selected]);

  // Padded: the screen itself is flush to the shell's edges, so a bare
  // spinner would sit in the very corner.
  if (isLoading) return <div className="p-4"><Loading /></div>;

  const pid = selected ? String(selected.project_id ?? 0) : null;

  /**
   * Which conversation the chat pane should open.
   *
   * The super-agent has no per-agent conversation files — it talks on channels,
   * and its history is the cross-channel ledger — so its row addresses a
   * THREAD (channel + date). A project agent addresses a conversation. With
   * neither, fall through to a live session rather than showing nothing.
   */
  const selectionFor = (row: InboxRow): ChatKey | undefined => {
    if (row.kind === "super_agent") {
      return row.channel && row.conversation_id
        ? { kind: "thread", channel: row.channel, threadId: row.conversation_id }
        : undefined;
    }
    return row.conversation_id
      ? { kind: "conv", agentSlug: row.agent_slug, convId: row.conversation_id }
      : { kind: "live", agentSlug: row.agent_slug };
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden" data-testid="inbox-screen">
      <InboxList
        rows={rows}
        selectedKey={selected ? rowKey(selected) : null}
        onSelect={setSelected}
        action={
          <Tip content={includeEmpty ? t("inbox.hide_quiet") : t("inbox.show_quiet")}>
            <Button
              size="sm"
              variant={includeEmpty ? "primary" : "ghost"}
              aria-label={includeEmpty ? t("inbox.hide_quiet") : t("inbox.show_quiet")}
              onClick={() => setIncludeEmpty((v) => !v)}
            >
              {includeEmpty ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
          </Tip>
        }
      />

      <section className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <Empty fill icon={Inbox}>{t("inbox.empty")}</Empty>
        ) : (
          /* Remounted per selection: the chat surface holds its own session
             state, and carrying one agent's stream into another agent's pane
             would be worse than a moment's reload. */
          <ChatTab
            /* The thread is part of the identity: when the selected agent moves
               to a new day's thread the pane must reopen on it, and ChatTab
               reads its initial selection once, at mount. */
            key={`${rowKey(selected)}::${selected.channel ?? ""}::${selected.conversation_id ?? ""}`}
            pid={pid as string}
            hideSidebar
            bare
            initialSelection={selectionFor(selected)}
            /* The structural way out. The inbox is a second axis over the same
               data, so getting from a conversation to its project must always
               be one click — it just lives in the thread's own button row now
               instead of a header duplicating the agent's name above it. */
            onOpenInProject={() =>
              navigate(
                selected.kind === "super_agent"
                  ? "/p/0/chat"
                  : `/p/${selected.project_id}/agents/${encodeURIComponent(selected.agent_slug)}`,
              )}
          />
        )}
      </section>
    </div>
  );
}
