import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RuntimeRoomView } from "../components/runtime/RuntimeConversation";
import { EyeOff, Eye, Inbox, TerminalSquare } from "lucide-react";
import { Button, Empty, Loading } from "../components/ui";
import { Tip } from "../components/ui/tip";
import { InboxList } from "../components/inbox/InboxList";
import { inboxRowKey, markRowRead } from "../lib/chat-read";
import { chatInProjectUrl, urlLooksAt } from "./mobile/routes";
import { NewChatSheet } from "./mobile/NewChatSheet";
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
  const { rows, isLoading, mutate } = useInbox(includeEmpty);
  const [selected, setSelected] = useState<InboxRow | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  // Open what the URL asked for, else the most recent conversation. An inbox
  // that lands on an empty pane makes you click twice to see the thing you
  // came for — but one that ignores its own deep link is worse: every
  // `/inbox?channel=…&thread=…` anybody shares (an agent pointing at what it
  // just wrote, a link in a report) silently opened the newest chat instead,
  // and the reader had no way to tell they were looking at the wrong thing.
  const [params] = useSearchParams();
  // BOTH spellings, which is the half that was missing. ChatTab addresses a
  // session two ways — `?channel=&thread=` for a channel thread and
  // `?agent=&conv=` for an agent's conversation (see mobile/routes.ts) — and
  // this screen only ever read the first. So `/inbox?agent=X&conv=Y` opened the
  // NEWEST chat instead, silently: Manu refreshed on a conversation with a
  // message parked in it, landed in a different one, and reasonably read that
  // as the message having been lost. It had not — he was reading somewhere
  // else. `urlLooksAt` already answers "does this URL mean this row?" for every
  // form, so it is asked rather than half re-implemented here.
  const asked = params.get("channel") || params.get("thread") || params.get("agent") || params.get("conv")
    ? params.toString()
    : null;
  // What the URL last asked for and we honoured. Without it the deep link was
  // a FIRST-PAINT-ONLY feature: the effect below bailed on `selected`, so once
  // anything was open, navigating to `/inbox?channel=…&thread=…` changed the
  // address bar and nothing else. That is the common case, not the rare one —
  // the background-jobs panel's "open the chat" is pressed from inside the
  // inbox more often than from outside it, and it silently did nothing.
  const [applied, setApplied] = useState<string | null>(null);
  useEffect(() => {
    if (!rows.length) return;
    // Already open, or nothing asked and something already chosen: leave it be.
    // Re-selecting on every render would fight the user's own clicks.
    if (asked ? asked === applied : !!selected) return;
    const match = asked
      ? rows.find((r) => urlLooksAt(`/inbox?${asked}`, r))
      : null;
    if (asked) setApplied(asked);
    // Falling back to the newest row is deliberate: a link to a thread that has
    // since rolled over to a new day should still land you IN the inbox rather
    // than on a blank pane.
    setSelected(match || selected || rows[0]);
  }, [rows, selected, applied, asked]);

  // Follow the row, not the snapshot of it. The list refreshes underneath as
  // messages arrive, and the same agent can point at a DIFFERENT thread than it
  // did a minute ago — the ledger is a file per day, so the first message after
  // midnight starts a new one. A selection frozen at click time would leave you
  // reading yesterday while today filled up.
  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => inboxRowKey(r) === inboxRowKey(selected));
    if (!fresh) return;
    // What counts as "moved" is in lib/inbox-selection — channel AND id, for a
    // reason worth reading before touching this.
    if (threadMoved(selected, fresh)) setSelected(fresh);
  }, [rows, selected]);

  // The open conversation is a read one — including whatever lands in it while
  // you sit here. The inbox keeps its selection in state rather than in the
  // URL, so the URL rule in lib/chat-read cannot see this pane; saying so here
  // is what keeps a dot off the row you are looking straight at.
  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => inboxRowKey(r) === inboxRowKey(selected));
    markRowRead(fresh || selected);
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
    // An a2a or group chat opens its thread, not any single agent's conversation.
    if ((row.kind === "a2a" || row.kind === "group") && row.conversation_id) {
      return { kind: "thread", channel: row.kind, threadId: row.conversation_id };
    }
    return row.conversation_id
      ? { kind: "conv", agentSlug: row.agent_slug, convId: row.conversation_id }
      : { kind: "live", agentSlug: row.agent_slug };
  };

  const openLive = (row: InboxRow) => {
    setSelected({
      ...row,
      conversation_id: null,
      channel: "web",
      messages: 0,
      preview: null,
      last_activity_at: new Date().toISOString(),
    });
  };

  const openGroup = async (info: {
    id: string;
    title: string;
    participants: string[];
    project_id: number | string;
  }) => {
    const fresh = await mutate();
    const hit = (fresh || []).find(
      (r) => r.kind === "group" && r.conversation_id === info.id,
    );
    setSelected(
      hit || {
        project_id: info.project_id,
        project_name: null,
        project_path: null,
        agent_slug: `group:${info.id}`,
        agent_name: info.title,
        agent_emoji: null,
        agent_icon: null,
        kind: "group",
        participants: info.participants,
        pinned: false,
        conversation_id: info.id,
        channel: "group",
        messages: 0,
        preview: null,
        last_activity_at: new Date().toISOString(),
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden" data-testid="inbox-screen">
      <InboxList
        rows={rows}
        selectedKey={selected ? inboxRowKey(selected) : null}
        onSelect={setSelected}
        onNew={() => setNewOpen(true)}
        action={
          <>
          {/* The sessions archive. The list beside it already holds the recent
              rooms; this is every run there has ever been, and until now the
              only way in was typing the URL. */}
          <Tip content={t("mobile.runtimes_title")}>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("mobile.runtimes_title")}
              data-testid="inbox-open-runtimes"
              onClick={() => navigate("/runtimes")}
            >
              <TerminalSquare size={14} />
            </Button>
          </Tip>
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
          </>
        }
      />

      <NewChatSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onPick={openLive}
        onGroupCreated={(info) => void openGroup(info)}
        /* Same as the phone: the session is running, so show it. */
        onRuntimeStarted={(info) => {
          setNewOpen(false);
          navigate(`/runtimes?session=${encodeURIComponent(info.session_id)}&pid=${info.project_id}`);
        }}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <Empty fill icon={Inbox}>{t("inbox.empty")}</Empty>
        ) : selected.kind === "runtime" && selected.conversation_id ? (
          /* A coding session is a room like the others in this list, but the one
             answering is an ENGINE, not an agent: there is no turn to take, no
             roster to mention, and writing into it resumes the session rather
             than asking anybody to relay. So it renders its own conversation
             here instead of being forced through ChatTab, which is built around
             an agent's turn and would have opened a conversation file that does
             not exist (`runtime:<id>` owns none).

             The same component the phone uses, deliberately: a second transcript
             renderer would be free to disagree with the first about who said
             what, which is the confusion this whole room exists to end. */
          <RuntimeRoomView
            projectId={selected.project_id ?? 0}
            sessionId={selected.conversation_id}
            runtime={selected.runtime}
            projectName={selected.project_name}
          />
        ) : (
          /* Remounted per selection: the chat surface holds its own session
             state, and carrying one agent's stream into another agent's pane
             would be worse than a moment's reload. */
          <ChatTab
            /* The thread is part of the identity: when the selected agent moves
               to a new day's thread the pane must reopen on it, and ChatTab
               reads its initial selection once, at mount. */
            key={`${inboxRowKey(selected)}::${selected.channel ?? ""}::${selected.conversation_id ?? ""}`}
            pid={pid as string}
            hideSidebar
            bare
            /* The inbox spans every project at once, so the header has to say
               which one this conversation belongs to — the list row does, and
               opening it used to lose that. */
            showProject
            initialSelection={selectionFor(selected)}
            /* The structural way out. The inbox is a second axis over the same
               data, so getting from a conversation to its project must always
               be one click — it just lives in the thread's own button row now
               instead of a header duplicating the agent's name above it. */
            onOpenInProject={() => navigate(chatInProjectUrl(selected))}
          />
        )}
      </section>
    </div>
  );
}
