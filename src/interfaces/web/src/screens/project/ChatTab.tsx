import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR, { mutate } from "swr";
import { Archive, ArchiveRestore, ArrowDown, ArrowUpRight, ChevronLeft, MessageSquareDashed, MoreVertical, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Agents, Conversations } from "../../lib/api";
import { Button, Dialog, Empty, Field, Input, Loading, Switch, Tip } from "../../components/ui";
import { Composer } from "../../components/chat/Composer";
import { MessageList } from "../../components/chat/MessageList";
import { ContextBar } from "../../components/chat/ContextBar";
import { InlineAskPanel, pendingAskQuestions } from "../../components/chat/InlineAskPanel";
import { ChatList, type ChatKey, type ChatSelectionMeta } from "../../components/chat/ChatList";
import { SessionPicker } from "../../components/chat/SessionPicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { useChat, type ChatMsg } from "../../hooks/useChat";
import { useLiveMessages } from "../../hooks/useLiveMessages";
import { concernsConversation, concernsThread, type LiveEvent } from "../../lib/live";
import type { UploadedMedia } from "../../lib/api/media";
import { useToast } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneChip } from "../../lib/tone";
import { usePersonaName } from "../../hooks/usePersonaName";
import { AgentAvatar, SUPER_AGENT_ICON, type AgentFace } from "../../components/agents/AgentAvatar";
import type { AgentEntry, ConversationListEntry } from "../../types/daemon";

// Virtual entry slug used in the agent dropdown to address the daemon-level
// super-agent (persona "Roby" for the owner). Picked so it can't collide
// with a real APC agent slug (which must match /^[a-z][a-z0-9_-]*$/).
const ROBY_SLUG = "__super_agent__";

/**
 * `hideSidebar` lets another screen (the agent inbox) supply its own
 * conversation list and embed just the thread. The chat surface is not forked
 * — one implementation, two frames around it.
 */
export function ChatTab({
  pid,
  hideSidebar = false,
  hideHeader = false,
  initialSelection,
  bare = false,
  onOpenInProject,
  compact = false,
  onBack,
  onSelectionChange,
}: {
  pid: string;
  hideSidebar?: boolean;
  /** Drop the thread header. The phone surface draws its own — with the back
   *  button and the session switcher on it — and two stacked headers naming the
   *  same agent is a rendering bug, not a layout. */
  hideHeader?: boolean;
  /** Open a specific conversation on mount instead of a fresh live session. */
  initialSelection?: ChatKey;
  /** Drop the card chrome. An embedding screen already draws a panel around
   *  this, and a card inside a card reads as a rendering bug. */
  bare?: boolean;
  /** Structural way out, shown as a header action. Only the inbox passes it:
   *  inside a project you are already where it would take you. */
  onOpenInProject?: () => void;
  /** Phone shaping: no avatar column, wider bubbles, and a header sized for a
   *  thumb with its actions folded behind one ⋯. The phone surface sets it; the
   *  desktop pane never does. */
  compact?: boolean;
  /** Renders the back arrow in the header. Only the phone has anywhere to go
   *  back TO — inside a project the chat is a tab, not a screen. */
  onBack?: () => void;
  /** The host owns the URL. Passed by the phone surface, where a session is a
   *  path segment rather than a query string, so picking one has to navigate
   *  instead of writing `?conv=` that a reload would not read back. */
  onSelectionChange?: (key: ChatKey) => void;
}) {
  const toast = useToast();
  const [params, setSearchParams] = useSearchParams();
  const agents = useSWR(`/api/projects/${pid}/agents`, () => Agents.list(pid));
  const [creating, setCreating] = useState(false);
  const [model, setModel] = useState("");
  const [dismissedAskKey, setDismissedAskKey] = useState<string | null>(null);
  const { msgs, send: sendChat, stop, clear, load, loadThread, streaming, queued, unqueue, conversationMeta } =
    useChat(pid, (m) => toast.error(m));
  const persona = usePersonaName();

  // How tall the floating dock currently is. It moves constantly — a draft
  // wrapping to a third line, an attachment strip appearing, the context panel
  // opening — and the thread needs the live number, not a guess, or the last
  // message ends up behind the field exactly when you are reading it.
  //
  // A callback ref, not an effect on a ref object: this component renders
  // <Loading/> until the agent list arrives, so a mount effect would look for a
  // dock that does not exist yet, find null, and never run again — leaving the
  // inset at zero and the field parked on top of the last three lines.
  const [dockH, setDockH] = useState(0);
  // While the context detail is open the dock is temporarily much taller, and
  // the thread must NOT reserve that: opening a panel for two seconds should
  // cover the conversation, not shove it up and drop it back down. So the inset
  // is the last height measured with the panel shut.
  const [ctxOpen, setCtxOpen] = useState(false);
  const restingDock = useRef(0);
  if (!ctxOpen) restingDock.current = dockH;
  const bottomInset = ctxOpen ? restingDock.current : dockH;

  // Whether the reader is following the end of the thread, and what they have
  // missed while they were not. Nothing scrolls on its own any more, so the
  // count is the only way to know something arrived while you were reading
  // further up — an arrow that appears silently is easy to look straight past.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [missed, setMissed] = useState(0);
  const seenCount = useRef(0);
  useEffect(() => {
    if (atBottom) {
      seenCount.current = msgs.length;
      setMissed(0);
      return;
    }
    setMissed(Math.max(0, msgs.length - seenCount.current));
  }, [msgs.length, atBottom]);

  const jumpToLatest = useCallback(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);
  const dockWatch = useRef<ResizeObserver | null>(null);
  const dockRef = useCallback((el: HTMLDivElement | null) => {
    dockWatch.current?.disconnect();
    if (!el) {
      dockWatch.current = null;
      return;
    }
    const ro = new ResizeObserver(([entry]) => setDockH(entry.contentRect.height));
    ro.observe(el);
    dockWatch.current = ro;
  }, []);

  // Selection state — drives both the sidebar highlight and the right-pane
  // header. Restored from the URL query on mount (so a chat is deep-linkable),
  // defaulting to a live session with the super-agent so the chat works even on
  // a brand-new project with zero agents and zero conversations.
  const [selected, setSelected] = useState<ChatKey>(() => {
    // An embedding screen that already knows which conversation the user
    // picked wins over the URL — otherwise clicking a row in the inbox opens
    // an empty new session and the message you clicked on is nowhere.
    if (initialSelection) return initialSelection;
    const agent = params.get("agent");
    const conv = params.get("conv");
    const channel = params.get("channel");
    const thread = params.get("thread");
    if (channel && thread) return { kind: "thread", channel, threadId: thread };
    if (agent && conv) return { kind: "conv", agentSlug: agent, convId: conv };
    if (agent) return { kind: "live", agentSlug: agent };
    return { kind: "live", agentSlug: ROBY_SLUG };
  });
  // Nobody chose for us — no deep link in the URL, no host-supplied selection —
  // so let the sidebar open this project's most recent chat once its lists land.
  // Read once at mount: selectChat() writes those same params, and re-reading
  // them later would turn every switch back to a live session into an auto-pick.
  const [autoSelectLatest] = useState(
    () =>
      !initialSelection &&
      !params.get("conv") &&
      !params.get("thread") &&
      !params.get("agent"),
  );
  // Display metadata for the current selection (channel/created date/title),
  // carried from the sidebar so the header can show it without a second fetch.
  const [selectedMeta, setSelectedMeta] = useState<ChatSelectionMeta | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Select a chat and mirror its id into the URL query so the current chat is
  // shareable/deep-linkable. `replace` keeps navigation history clean.
  const selectChat = (key: ChatKey, meta?: ChatSelectionMeta) => {
    setSelected(key);
    setSelectedMeta(meta);
    // A host that owns the URL writes it in its own shape; writing both would
    // leave two spellings of the same thing to disagree on the next reload.
    if (onSelectionChange) {
      onSelectionChange(key);
      return;
    }
    const next = new URLSearchParams();
    if (key.kind === "conv") {
      next.set("agent", key.agentSlug);
      next.set("conv", key.convId);
    } else if (key.kind === "thread") {
      next.set("channel", key.channel);
      next.set("thread", key.threadId);
    } else {
      next.set("agent", key.agentSlug);
    }
    setSearchParams(next, { replace: true });
  };

  const agentList = agents.data || [];
  const isRoby = (slug: string | null | undefined) => slug === ROBY_SLUG;

  // The agent whose dropdown badge / model we show on the right header.
  // Channel threads always belong to the super-agent, so no project agent.
  const activeAgent = useMemo(
    () =>
      selected.kind === "thread"
        ? undefined
        : agentList.find((a) => a.slug === selected.agentSlug),
    [agentList, selected],
  );
  const activeIsRoby = selected.kind === "thread" || isRoby(selected.agentSlug);

  // Whenever the user picks a stored conversation or a channel thread, reload
  // the in-memory chat with its persisted history. Conversations bind the
  // conversation_id (sends append to the file); threads stay unbound —
  // continuing sends fresh web turns with the thread as context.
  useEffect(() => {
    if (selected.kind === "conv") {
      void load(selected.agentSlug, selected.convId);
    } else if (selected.kind === "thread") {
      void loadThread(selected.channel, selected.threadId);
    } else {
      // Live session selected → always start from a clean slate. (Threads leave
      // conversationId undefined, so an `if (conversationId)` guard would skip
      // clearing and the previous chat's messages would linger under the new
      // header — the "title changes but content stays" bug.)
      clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selected.kind,
    selected.kind === "conv"
      ? selected.convId
      : selected.kind === "thread"
        ? `${selected.channel}:${selected.threadId}`
        : selected.agentSlug,
  ]);

  // The conversation on screen moved somewhere ELSE — a message on Telegram,
  // another device on the same thread, a routine writing into the file. The
  // daemon says which thread moved and we re-read it; nothing arrives over the
  // socket except the fact that something did (see lib/live.ts).
  //
  // Skipped while this tab is streaming its own answer: the turn being painted
  // token by token is not in storage yet, and re-reading mid-stream would
  // replace it with a version that stops at the last thing written.
  useLiveMessages(
    useCallback(
      (events: LiveEvent[]) => {
        if (streaming) return;
        if (selected.kind === "thread") {
          if (events.some((e) => concernsThread(e, selected.channel, selected.threadId))) {
            void loadThread(selected.channel, selected.threadId, { silent: true });
          }
        } else if (selected.kind === "conv") {
          if (events.some((e) => concernsConversation(e, selected.agentSlug, selected.convId))) {
            void load(selected.agentSlug, selected.convId, { silent: true });
          }
        }
        // A live session has no stored thread to catch up with: everything it
        // shows was produced in this tab.
      },
      [selected, streaming, load, loadThread],
    ),
  );

  const send = async (text: string, media?: UploadedMedia[]) => {
    if (activeIsRoby) {
      await sendChat(text, {
        model: model || undefined,
        ...(media?.length ? { attachments: media } : {}),
      });
      // The turn just wrote itself into the channel ledger. Revalidate so the
      // new chat shows up in the sidebar now, instead of only after a reload —
      // which read as "the conversation was lost".
      void mutate(`/api/projects/${pid}/super-agent/threads`);
      return;
    }
    if (!activeAgent) return;
    await sendChat(text, { model: model || undefined, agentSlug: activeAgent.slug });
    void mutate(`/api/projects/${pid}/agents/${activeAgent.slug}/conversations`);
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.info(t("project.chat.copied")); }
    catch { /* ignore */ }
  };

  // "+ New" from the sidebar: start a fresh in-memory session with the picked
  // agent (super-agent or a project agent). It materialises in the Web group
  // once the first message is sent.
  const onNewChat = (agentSlug: string) => {
    selectChat({ kind: "live", agentSlug });
    clear();
  };

  // "New session" header button: reset the pane but stay with the current
  // agent (Roby for channel threads / the super-agent, else the project agent).
  const newSession = () => {
    const agentSlug = activeIsRoby ? ROBY_SLUG : activeAgent?.slug ?? selected.agentSlug;
    selectChat({ kind: "live", agentSlug });
    clear();
  };

  // "Delete" header button: permanently remove the persisted conversation
  // (agent `.md` file) or channel thread (ledger day-file), then reset the pane
  // and revalidate the sidebar list so the entry disappears.
  const doDelete = async () => {
    setDeleting(true);
    try {
      if (selected.kind === "conv") {
        await Conversations.remove(pid, selected.agentSlug, selected.convId);
        void mutate(`/api/projects/${pid}/agents/${selected.agentSlug}/conversations`);
      } else if (selected.kind === "thread") {
        await Conversations.removeThread(pid, selected.channel, selected.threadId);
        void mutate(`/api/projects/${pid}/super-agent/threads`);
      }
      toast.success(t("project.chat.deleted"));
      setConfirmDelete(false);
      await openNeighbour();
    } catch (e) {
      toast.error((e as Error)?.message || t("shared_ui.err_chat_failed"));
    } finally {
      setDeleting(false);
    }
  };

  /** Both lists that could be showing this session. Cheaper to revalidate the
   *  pair than to work out which frame we are in. */
  const refreshSessions = () => {
    if (selected.kind === "thread") void mutate(`/api/projects/${pid}/super-agent/threads`);
    else if (selected.kind === "conv") void mutate(`/api/projects/${pid}/agents/${selected.agentSlug}/conversations`);
    void mutate(`sessions:${pid}:${activeAgent?.slug || ""}:${activeIsRoby}`);
  };

  /** Name it something you will recognise. An empty name is not an error — it
   *  drops the override, and the derived one (the first thing said) comes back. */
  const doRename = async (title: string) => {
    try {
      if (selected.kind === "conv") {
        await Conversations.update(pid, selected.agentSlug, selected.convId, { title });
      } else if (selected.kind === "thread") {
        await Conversations.updateThread(pid, selected.channel, selected.threadId, { title });
      }
      setSelectedMeta((m) => ({ ...(m || {}), title: title.trim() || undefined }) as ChatSelectionMeta);
      refreshSessions();
      setRenaming(null);
      toast.success(t("project.chat.renamed"));
    } catch (e) {
      toast.error((e as Error)?.message || t("shared_ui.err_chat_failed"));
    }
  };

  /** Put away, or take back out. The smaller decision than deleting: the record
   *  stays exactly where it is and only leaves the lists that offer chats to
   *  resume, so archiving is never the end of anything. */
  const doArchive = async (archived: boolean) => {
    try {
      if (selected.kind === "conv") {
        await Conversations.update(pid, selected.agentSlug, selected.convId, { archived });
      } else if (selected.kind === "thread") {
        await Conversations.updateThread(pid, selected.channel, selected.threadId, { archived });
      }
      refreshSessions();
      toast.success(t(archived ? "project.chat.archived_ok" : "project.chat.unarchived_ok"));
      // Archiving takes this thread out of the list you are reading it from, so
      // stay somewhere that still exists. Un-archiving leaves you put.
      if (archived) await openNeighbour();
    } catch (e) {
      toast.error((e as Error)?.message || t("shared_ui.err_chat_failed"));
    }
  };

  /** Where to land once a conversation is gone: the most recent one still
   *  there, for the same agent or the same channel wall. Dropping the reader on
   *  an empty new session instead is the app answering "deleted" with "and now
   *  you are nowhere" — the thread next to it is what they were reading around.
   *  An empty list, or a list we cannot fetch, still falls back to a fresh one. */
  const openNeighbour = async () => {
    try {
      if (selected.kind === "conv") {
        const gone = selected.convId;
        const slug = selected.agentSlug;
        const rest = (await Conversations.list(pid, slug)).filter((c) => c.id !== gone);
        const next = rest.sort(byRecency)[0];
        if (next) return selectChat({ kind: "conv", agentSlug: slug, convId: next.id });
      } else if (selected.kind === "thread") {
        const { channel, threadId } = selected;
        const rest = (await Conversations.threads(pid)).filter(
          (th) => !(th.channel === channel && th.id === threadId),
        );
        const next = [...rest].sort((a, b) => (b.last_ts || b.id).localeCompare(a.last_ts || a.id))[0];
        if (next) return selectChat({ kind: "thread", channel: next.channel, threadId: next.id });
      }
    } catch {
      /* the list is unreachable: a fresh session is still a place to be */
    }
    newSession();
  };

  // The header answers WHO first and WHICH CONVERSATION second: the agent's
  // face and name on the title line, the thread's own identity (title, date,
  // channel) demoted to the meta line under it. It used to lead with the
  // conversation id — a bare date string — while the agent was a chip off to
  // the right, so a thread looked like it belonged to nobody.
  const agentLabel = activeIsRoby ? persona : activeAgent?.name || activeAgent?.slug || selected.agentSlug;
  const channelLabel =
    selected.kind === "thread" ? selected.channel : selectedMeta?.channel || "web";
  const createdIso =
    selected.kind === "thread" ? selected.threadId : selectedMeta?.createdAt;

  // What this session is CALLED. The loaded file (or thread) knows its own
  // name, including the one the reader gave it; the list row is only what
  // happened to be carried in from wherever you clicked, and on a deep link
  // there is no row at all — which is how the header ended up showing a bare
  // date where the name should be.
  const convLabel =
    selected.kind === "live"
      ? ""
      : conversationMeta?.title ||
        selectedMeta?.title ||
        (selected.kind === "thread" ? selected.threadId : selected.convId);
  // Kept as the delete-dialog subject: there the conversation, not the agent,
  // is the thing being destroyed.
  const headerTitle = convLabel || t("project.chat.live_title", { agent: agentLabel });
  // The loaded file knows its own channel and engine; the selection metadata is
  // only what the list row happened to carry. Prefer the file — a routine
  // conversation was reading as "new chat · web" with no model named anywhere.
  const shownChannel = conversationMeta?.channel || channelLabel;
  // One face per speaker, resolved from the same data the inbox uses. Turns a
  // delegated agent produced inside a super-agent thread keep THEIR face, so a
  // multi-agent thread is readable without expanding anything.
  const headerFace: AgentFace = activeIsRoby
    ? { icon: SUPER_AGENT_ICON, name: persona }
    : { icon: activeAgent?.icon, emoji: activeAgent?.emoji, name: agentLabel };

  const faceFor = (msg: ChatMsg): AgentFace => {
    const id = msg.agentId || msg.agent;
    if (!id) return headerFace;
    if (id === "super_agent") return { icon: SUPER_AGENT_ICON, name: msg.agent || persona };
    const hit = agentList.find((a) => a.slug === id || a.name === id);
    if (hit) return { icon: hit.icon, emoji: hit.emoji, name: hit.name || hit.slug };
    return { ...headerFace, name: msg.agent || headerFace.name };
  };

  // A stored session is the only kind you can name, put away or destroy: a live
  // one is not anywhere yet.
  const storedSession = selected.kind === "conv" || selected.kind === "thread";
  const isArchived = !!selectedMeta?.archived;
  const newSessionAction = {
    key: "new",
    icon: RotateCcw,
    label: t("project.chat.new_session"),
    onClick: () => setConfirmNew(true),
    disabled: streaming || msgs.length === 0,
  };

  // What the ⋯ holds: everything that edits THIS session. Described once, so
  // the phone and the desktop cannot drift into offering different things.
  const menuActions = [
    // On a phone there is no room for a second control, so it starts here too.
    ...(compact ? [newSessionAction] : []),
    ...(storedSession
      ? [
          {
            key: "rename",
            icon: Pencil,
            label: t("project.chat.rename"),
            onClick: () => setRenaming(convLabel || ""),
            disabled: false,
          },
          {
            key: "archive",
            icon: isArchived ? ArchiveRestore : Archive,
            label: t(isArchived ? "project.chat.unarchive" : "project.chat.archive"),
            onClick: () => void doArchive(!isArchived),
            disabled: streaming,
          },
        ]
      : []),
  ];
  // Below the line, on its own: the one that cannot be taken back.
  const deleteAction = storedSession
    ? { key: "delete", icon: Trash2, label: t("project.chat.delete"), onClick: () => setConfirmDelete(true), disabled: streaming }
    : null;

  if (agents.isLoading) return <Loading />;

  return (
    <div className={cn("flex h-full min-h-0 overflow-hidden", !bare && "rounded-xl border border-border bg-card/40")}>
      {hideSidebar ? null : <ChatList
        pid={pid}
        agents={agentList}
        superAgentSlug={ROBY_SLUG}
        superAgentLabel={t("agents_ui.super_agent_label", { persona })}
        selected={selected}
        onSelect={selectChat}
        onNewChat={onNewChat}
        autoSelectLatest={autoSelectLatest}
      />}

      {/* min-h-0 is what makes the message list the only scroller: without it a
          flex child refuses to shrink below its content, the column grows past
          the viewport, and the composer sits under the fold with no way to
          reach it. Invisible on a tall desktop pane, fatal on a phone. */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {hideHeader ? null : <header
          className={cn(
            "flex shrink-0 items-center justify-between gap-3 border-b border-border",
            // The phone pays for the notch here rather than in a second header
            // of its own: one implementation, two frames around it.
            compact ? "gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]" : "px-3 py-2",
          )}
        >
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("mobile.back")}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-fg active:bg-accent/60"
            >
              <ChevronLeft size={22} />
            </button>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <AgentAvatar {...headerFace} size={compact ? 36 : 30} />
            {/* The session on top, WHO on the line under it. The header used to
                lead with the agent and demote the thread to a date in the meta
                line — but the agent's face is already sitting right there, and
                the date was standing in the one place the name should be. */}
            <div className="min-w-0 flex-1">
              <SessionPicker
                pid={pid}
                agentSlug={activeAgent?.slug || (selected.kind === "thread" ? "" : selected.agentSlug)}
                isSuper={activeIsRoby}
                selected={selected}
                label={convLabel || t("mobile.live_session")}
                onPick={selectChat}
                className={cn(
                  "max-w-full font-semibold text-foreground",
                  compact ? "text-[15px] leading-tight" : "text-sm",
                )}
              />
              {/* Who answered, where, and when — three facts, each short. Kept
                  on one line and truncated as a whole, so a long agent name
                  cannot push the channel and the date onto a second row. */}
              <p className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-fg">
                <span className="truncate">{agentLabel}</span>
                {/* Not on a phone: at 375px the badge and the two facts after it
                    squeezed "Roby" down to "Ro…", and the face two inches to
                    the left already says which agent this is. */}
                {activeIsRoby && !compact && (
                  <span className={cn("shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide", toneChip.emerald)}>
                    {t("agents_ui.super_agent_badge")}
                  </span>
                )}
                <span className="shrink-0">· {shownChannel}</span>
                {createdIso && <span className="shrink-0">· {formatDate(createdIso)}</span>}
                {conversationMeta?.engine && !compact && (
                  <span className="truncate">· {conversationMeta.engine}</span>
                )}
              </p>
            </div>
          </div>

          {/* Same actions on both surfaces, presented for the room available:
              spelled out where there is width, folded behind one ⋯ where there
              is not. On the phone they used to be absent altogether. */}
          <div className="flex shrink-0 items-center gap-1">
            {!agentList.length && !activeIsRoby && !compact && (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} /> {t("project.chat.create_agent")}
              </Button>
            )}
            {/* Navigation says so in words — it is the one action here that
                takes you somewhere rather than changing something. */}
            {onOpenInProject && !compact && (
              <Button variant="ghost" size="sm" onClick={onOpenInProject}>
                {t("inbox.open_in_project")} <ArrowUpRight size={13} />
              </Button>
            )}
            {!compact && (
              <Tip content={newSessionAction.label}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={newSessionAction.label}
                  disabled={newSessionAction.disabled}
                  onClick={newSessionAction.onClick}
                >
                  <RotateCcw size={13} />
                </Button>
              </Tip>
            )}
            {(menuActions.length > 0 || deleteAction) && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={t("common.more")}
                  className={cn(
                    "flex items-center justify-center rounded-full text-muted-fg data-[popup-open]:bg-accent/60",
                    compact ? "size-10 active:bg-accent/60" : "size-8 hover:bg-accent/60",
                  )}
                >
                  <MoreVertical size={compact ? 20 : 16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={6} className="w-60">
                  {/* Which session these act on, named at the top — the same
                      thing the project's right-click menu does. Without it the
                      menu is four verbs with no subject. */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="truncate text-[11px] font-normal text-muted-fg">
                      {convLabel || t("mobile.live_session")}
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  {menuActions.map((a) => (
                    <DropdownMenuItem key={a.key} onClick={a.onClick} disabled={a.disabled}>
                      <a.icon className="size-4" /> {a.label}
                    </DropdownMenuItem>
                  ))}
                  {deleteAction && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={deleteAction.onClick}
                        disabled={deleteAction.disabled}
                        className="text-destructive"
                      >
                        <Trash2 className="size-4 text-destructive" /> {deleteAction.label}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>}

        {/* The thread and the dock share the same box: the composer HOVERS over
            the conversation instead of taking a slice of the column away from
            it. The list is given the dock's exact height as trailing space, so
            the last line can always be scrolled clear of the field — floating
            over the text is only an improvement while you can still read the
            line you are answering. */}
        <div className="relative min-h-0 flex-1">
          <div ref={scrollerRef} className="h-full overflow-y-auto overflow-x-hidden">
            {msgs.length || queued.length ? (
              <MessageList
                msgs={msgs}
                queued={queued}
                onUnqueue={unqueue}
                onCopy={copyToClipboard}
                faceFor={faceFor}
                compact={compact}
                bottomInset={bottomInset}
                onAtBottomChange={setAtBottom}
              />
            ) : (
              <Empty fill icon={MessageSquareDashed}>{t("project.chat.empty")}</Empty>
            )}
          </div>

          {/* The way back to the end, once leaving it is something you can do
              without being dragged straight back. Positioned against the same
              box as the dock and sized by it, so it clears the field without
              being part of it — inside the dock it would grow the space the
              thread reserves, and the conversation would jump every time this
              appeared. */}
          {!atBottom && msgs.length > 0 && (
            <button
              type="button"
              onClick={jumpToLatest}
              aria-label={missed ? t("chat_ui.jump_latest_new") : t("chat_ui.jump_latest")}
              // Against the dock's REAL height, not the frozen inset: it has to
              // clear whatever is actually on screen, panel included.
              style={{ bottom: dockH + 8 }}
              className={cn(
                "absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border",
                "bg-card px-3 py-1.5 text-xs shadow-lg transition-colors hover:bg-accent",
                missed > 0 && "border-primary/50 text-primary",
              )}
            >
              <ArrowDown size={14} />
              {missed > 0 && <span className="font-medium tabular-nums">{missed}</span>}
            </button>
          )}

          <div ref={dockRef} className="absolute inset-x-0 bottom-0">
            <Composer
              onSend={send}
              onStop={stop}
              streaming={streaming}
              model={model}
              onModelChange={setModel}
              allowFiles={activeIsRoby}
              floating
              // The strip and the questions are both part of the field: what the
              // turn cost, and what it is waiting on. The panel used to hover as
              // a separate card above the composer, which put the thing you have
              // to answer somewhere other than the thing you answer with.
              context={
                <>
                  <ContextBar msgs={msgs} docked onOpenChange={setCtxOpen} />
                  {(() => {
                    const pending = !streaming ? pendingAskQuestions(msgs) : null;
                    if (!pending || pending.turnKey === dismissedAskKey) return null;
                    return (
                      <InlineAskPanel
                        docked
                        turnKey={pending.turnKey}
                        questions={pending.questions}
                        onSubmit={(compiled) => void send(compiled)}
                        onDismiss={() => setDismissedAskKey(pending.turnKey)}
                        disabled={streaming}
                      />
                    );
                  })()}
                </>
              }
            />
          </div>
        </div>
      </section>

      <CreateAgentDialog
        open={creating}
        pid={pid}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); agents.mutate(); }}
      />

      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={t("project.chat.rename_title")}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void doRename(renaming || "")}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <Field label={t("project.chat.rename_label")} hint={t("project.chat.rename_hint")}>
          <Input
            autoFocus
            value={renaming ?? ""}
            onChange={(e) => setRenaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doRename(renaming || "");
            }}
          />
        </Field>
      </Dialog>

      <Dialog
        open={confirmNew}
        onClose={() => setConfirmNew(false)}
        title={t("project.chat.new_session_confirm_title")}
        description={t("project.chat.new_session_confirm_desc")}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmNew(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => { setConfirmNew(false); newSession(); }}>
              <RotateCcw size={14} /> {t("project.chat.new_session")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-fg">{headerTitle}</p>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("project.chat.delete_confirm_title")}
        description={t("project.chat.delete_confirm_desc")}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={doDelete} loading={deleting}>
              <Trash2 size={14} /> {t("project.chat.delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-fg">{headerTitle}</p>
      </Dialog>
    </div>
  );
}

/** Most recent first. `ended_at` is when it was last written to; a conversation
 *  that has only ever been opened has just `started_at`, and the id is the last
 *  resort so the order is never arbitrary. */
function byRecency(a: ConversationListEntry, b: ConversationListEntry): number {
  const when = (c: ConversationListEntry) => c.ended_at || c.started_at || c.id;
  return when(b).localeCompare(when(a));
}

// Localised short date for the header "Created {date}" line. Falls back to the
// raw string for anything Date can't parse.
function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function CreateAgentDialog({
  open,
  onClose,
  onCreated,
  pid,
}: { open: boolean; onClose: () => void; onCreated: () => void; pid: string }) {
  const toast = useToast();
  const [slug, setSlug] = useState("");
  const [role, setRole] = useState("master");
  const [model, setModel] = useState("");
  const [isMaster, setIsMaster] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^[a-z][a-z0-9_-]*$/.test(slug)) {
      toast.error(t("project.agents.slug_invalid"));
      return;
    }
    setBusy(true);
    try {
      await Agents.create(pid, { slug, role, model: model || undefined, is_master: isMaster } as Partial<AgentEntry> & { slug: string });
      toast.success(t("project.agents.created", { slug }));
      setSlug("");
      setRole("master");
      setModel("");
      setIsMaster(true);
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("project.chat.create_agent_title")}
      description={t("project.chat.create_agent_desc")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>{t("common.create")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="slug">
          <Input autoFocus value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="master" />
        </Field>
        <Field label={t("project.chat.role_label")}>
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="master" />
        </Field>
        <Field label={t("project.chat.model_label")} hint={t("project.chat.model_hint")}>
          <Input value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Switch checked={isMaster} onChange={setIsMaster} label={t("project.chat.master_label")} />
      </div>
    </Dialog>
  );
}
