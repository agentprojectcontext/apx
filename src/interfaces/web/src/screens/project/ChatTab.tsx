import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR, { mutate } from "swr";
import { Archive, ArchiveRestore, ArrowDown, ArrowUpRight, ChevronLeft, MessageSquareDashed, MoreVertical, Pencil, Plus, RotateCcw, Trash2, UserPlus, X } from "lucide-react";
import { Agents, Conversations, Groups } from "../../lib/api";
import { Button, Dialog, Empty, Field, Input, Loading, Switch, Tip } from "../../components/ui";
import { Composer } from "../../components/chat/Composer";
import { MessageList } from "../../components/chat/MessageList";
import { ContextBar } from "../../components/chat/ContextBar";
import { InlineAskPanel, pendingAskQuestions } from "../../components/chat/InlineAskPanel";
import { ChatList, type ChatKey, type ChatSelectionMeta } from "../../components/chat/ChatList";
import { queryForChat } from "../mobile/routes";
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
import { useSuperAgentConfig } from "../../hooks/useGlobalConfig";
import { AgentAvatar, AgentAvatarGroup, SUPER_AGENT_ICON, type AgentFace } from "../../components/agents/AgentAvatar";
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
  channelScope,
  threadFaces,
  threadTitle,
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
  /** Limit the session switcher to one channel. The inbox and the phone pass
   *  "web" so their switcher never offers a Telegram thread; project-first
   *  navigation omits it and keeps every channel. */
  channelScope?: string;
  /** For an a2a thread: the participants' resolved faces and the "A · B" title.
   *  An a2a thread is a conversation BETWEEN two agents, not the super-agent's,
   *  so the header wears both faces and their names instead of Roby's. The host
   *  (inbox/phone) has these on the row; ChatTab has only the thread id. */
  threadFaces?: AgentFace[];
  threadTitle?: string;
}) {
  const toast = useToast();
  const [params, setSearchParams] = useSearchParams();
  const agents = useSWR(`/api/projects/${pid}/agents`, () => Agents.list(pid));
  const [creating, setCreating] = useState(false);
  const [model, setModel] = useState("");
  const [dismissedAskKey, setDismissedAskKey] = useState<string | null>(null);
  const { msgs, send: sendChat, sendGroup, regenerate, editAndResend, stop, clear, load, loadThread, streaming, queued, unqueue, conversationMeta } =
    useChat(pid, (m) => toast.error(m));
  const persona = usePersonaName();
  const { superAgent } = useSuperAgentConfig();
  const superAgentIcon = superAgent?.icon || SUPER_AGENT_ICON;

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
  const [addOpen, setAddOpen] = useState(false);
  // A pending group rewind awaiting confirmation (there are messages after the
  // target that the regenerate/edit would overwrite).
  const [groupRewind, setGroupRewind] = useState<
    { kind: "edit" | "regen"; keepVisible: number; drop: number; text?: string; from?: string; reason?: string | null } | null
  >(null);

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
    setSearchParams(queryForChat(key), { replace: true });
  };

  // An embedding host (the inbox) picks the thread via initialSelection and
  // never calls selectChat. Without this write, `/m/inbox` has no query, and
  // agent notifications cannot tell you are already reading the row that just
  // moved — they fire for a message already on screen.
  const initialAddr = initialSelection && !onSelectionChange ? queryForChat(initialSelection).toString() : "";
  useEffect(() => {
    if (!initialAddr) return;
    setSearchParams(new URLSearchParams(initialAddr), { replace: true });
  }, [initialAddr, setSearchParams]);

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

  const isA2A = selected.kind === "thread" && selected.channel === "a2a";
  const isGroup = selected.kind === "thread" && selected.channel === "group";
  // a2a and group are both multi-agent threads: many faces, no super-agent badge,
  // no rewind. Their name comes from the thread, not an agent.
  const isMultiThread = isA2A || isGroup;

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

  // A group opened from the sidebar carries no faces prop, so read its roster
  // from the thread: the header can then show every member and "add someone"
  // knows who is already in. Keyed on the thread so it refetches when a member
  // is added.
  const groupThreadKey =
    selected.kind === "thread" && selected.channel === "group"
      ? `/api/projects/${pid}/super-agent/threads/group/${selected.threadId}`
      : null;
  const groupThreadId = selected.kind === "thread" ? selected.threadId : "";
  const groupDetail = useSWR(groupThreadKey, () => Conversations.thread(pid, "group", groupThreadId));
  const groupParticipants = groupDetail.data?.participants ?? [];

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

  // A group room streams through useChat's own pending-bubble machinery — the
  // owner's line fans out to the members and each speaker's tokens land live,
  // exactly like a 1:1 turn. Refresh the sidebar/inbox once it settles.
  const nameOfSlug = (slug: string) => agentList.find((a) => a.slug === slug)?.name || slug;
  const groupSend = async (gid: string, text: string, media?: UploadedMedia[]) => {
    await sendGroup(gid, text, nameOfSlug, media?.length ? { media } : undefined);
    void mutate(`/api/projects/${pid}/super-agent/threads`);
    void mutate((key) => typeof key === "string" && key.startsWith(`/api/inbox`));
  };

  const send = async (text: string, media?: UploadedMedia[]) => {
    if (selected.kind === "thread" && selected.channel === "group") {
      await groupSend(selected.threadId, text, media);
      return;
    }
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
    await sendChat(text, {
      model: model || undefined,
      agentSlug: activeAgent.slug,
      ...(media?.length ? { attachments: media } : {}),
    });
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

  // "New group" from the sidebar: create the room, then open it as a group
  // thread. It shows in the Groups section (and the inbox) from here on.
  const onNewGroup = async (agentSlugs: string[]) => {
    try {
      const g = await Groups.create(pid, { participants: agentSlugs });
      void mutate(`/api/projects/${pid}/super-agent/threads`);
      selectChat({ kind: "thread", channel: "group", threadId: g.id }, { channel: "group", title: g.title });
    } catch (e) {
      toast.error((e as Error)?.message || t("shared_ui.err_chat_failed"));
    }
  };

  // Add a member to the CURRENT group room.
  const addToGroup = async (slug: string) => {
    if (selected.kind !== "thread") return;
    const gid = selected.threadId;
    try {
      await Groups.addParticipant(pid, gid, slug);
      await groupDetail.mutate();
      void loadThread("group", gid, { silent: true });
      void mutate(`/api/projects/${pid}/super-agent/threads`);
    } catch (e) {
      toast.error((e as Error)?.message || t("shared_ui.err_chat_failed"));
    }
  };

  // Remove a member from the current group (records a "… salió del chat" notice;
  // agents stop citing them). Keep at least one agent in the room.
  const removeFromGroup = async (slug: string) => {
    if (selected.kind !== "thread") return;
    const gid = selected.threadId;
    try {
      await Groups.removeParticipant(pid, gid, slug);
      await groupDetail.mutate();
      void loadThread("group", gid, { silent: true });
      void mutate(`/api/projects/${pid}/super-agent/threads`);
    } catch (e) {
      toast.error((e as Error)?.message || t("shared_ui.err_chat_failed"));
    }
  };

  // Escalate a 1:1 with a project agent into a group by pulling someone in.
  const escalateToGroup = async (slug: string) => {
    const base = activeAgent?.slug;
    if (!base) return;
    try {
      const g = await Groups.create(pid, { participants: [base, slug] });
      void mutate(`/api/projects/${pid}/super-agent/threads`);
      selectChat({ kind: "thread", channel: "group", threadId: g.id }, { channel: "group", title: g.title });
    } catch (e) {
      toast.error((e as Error)?.message || t("shared_ui.err_chat_failed"));
    }
  };

  // Who "add someone" offers: in a group, every agent not already in it; in a
  // 1:1 with a project agent, every other project agent (adding one makes it a
  // group). Not offered for the super-agent or a2a threads.
  // activeAgent is only set for a 1:1 with a project agent (undefined for threads
  // and the super-agent), so it alone marks the escalate-able case.
  const canAddPeople = isGroup || (!activeIsRoby && !!activeAgent);
  const addCandidates = isGroup
    ? agentList.filter((a) => !groupParticipants.includes(a.slug))
    : agentList.filter((a) => a.slug !== activeAgent?.slug);
  const onPickAdd = (slug: string) => (isGroup ? addToGroup(slug) : escalateToGroup(slug));

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
  // An a2a thread is a conversation BETWEEN two agents — not the super-agent's,
  // even though (like every stored thread) selected.kind is "thread". It gets
  // both faces and their "A · B" title, and none of the super-agent chrome.
  // Faces for the multi-agent header: the prop when the inbox handed us one,
  // else (a group opened from the sidebar) resolved from the thread's roster.
  const groupFaces: AgentFace[] = useMemo(
    () => groupParticipants.map((slug) => {
      const hit = agentList.find((a) => a.slug === slug);
      return { icon: hit?.icon, emoji: hit?.emoji, name: hit?.name || slug };
    }),
    [groupParticipants, agentList],
  );
  const a2aFaces = isMultiThread ? (threadFaces?.length ? threadFaces : (isGroup ? groupFaces : [])) : [];
  const agentLabel = isMultiThread
    ? threadTitle || conversationMeta?.title || (selected.kind === "thread" ? selected.threadId : "")
    : activeIsRoby ? persona : activeAgent?.name || activeAgent?.slug || selected.agentSlug;
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
      : isMultiThread
        ? threadTitle || conversationMeta?.title || (selected.kind === "thread" ? selected.threadId : "")
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
    ? { icon: superAgentIcon, name: persona }
    : { icon: activeAgent?.icon, emoji: activeAgent?.emoji, name: agentLabel };

  const faceFor = (msg: ChatMsg): AgentFace => {
    const id = msg.agentId || msg.agent;
    if (!id) return headerFace;
    if (id === "super_agent") return { icon: superAgentIcon, name: msg.agent || persona };
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

  // Go to the agent's card / project. On the desktop this is a header button
  // (below); the phone has no room for it there, so it rides in the ⋯ menu.
  const openInProjectAction = onOpenInProject
    ? {
        key: "open-project",
        icon: ArrowUpRight,
        label: t("inbox.open_in_project"),
        onClick: onOpenInProject,
        disabled: false,
      }
    : null;

  // What the ⋯ holds: everything that edits THIS session. Described once, so
  // the phone and the desktop cannot drift into offering different things.
  const menuActions = [
    // On a phone there is no room for a second control, so it starts here too.
    ...(compact && openInProjectAction ? [openInProjectAction] : []),
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

  // Regenerate / edit-and-resend are wired only for a project agent's own chat —
  // the case whose history the daemon rebuilds from a file we can rewind. The
  // super-agent's channel threads and a2a share a day-ledger, not a per-chat
  // file, so they're left out for now.
  const canRewind = !activeIsRoby && !!activeAgent && !isMultiThread && !streaming;
  const afterRewind = () =>
    void mutate(`/api/projects/${pid}/agents/${activeAgent?.slug}/conversations`);
  const onRegenerate = canRewind
    ? (index: number) => { void regenerate(index, { model: model || undefined, agentSlug: activeAgent!.slug }); afterRewind(); }
    : undefined;
  const onEditResend = canRewind
    ? (index: number, text: string) => { void editAndResend(index, text, { model: model || undefined, agentSlug: activeAgent!.slug }); afterRewind(); }
    : undefined;

  // ── Group rewind (regenerate / edit & resend) ─────────────────────────────
  // A group is a ledger thread, so rewinding truncates the ledger (not a file)
  // and then resumes the cascade from the target speaker. Regenerating the last
  // bubble keeps earlier replies this turn; regenerating an earlier one drops
  // everything after it (those speakers may be pulled back in by a new @mention).
  const gidOf = () => (selected.kind === "thread" ? selected.threadId : "");
  const runGroupEdit = async (keepVisible: number, text: string) => {
    const gid = gidOf();
    try { await Groups.truncate(pid, gid, keepVisible); } catch (e) { toast.error((e as Error)?.message); return; }
    await loadThread("group", gid, { silent: true });
    await groupSend(gid, text);
  };
  const runGroupRegen = async (keepVisible: number, from?: string, reason?: string | null) => {
    const gid = gidOf();
    if (streaming) return;
    try { await Groups.truncate(pid, gid, keepVisible); } catch (e) { toast.error((e as Error)?.message); return; }
    await loadThread("group", gid, { silent: true });
    await sendGroup(gid, "", nameOfSlug, { rerun: true, from, reason });
    void mutate(`/api/projects/${pid}/super-agent/threads`);
  };
  const groupRegenerate = (index: number) => {
    const target = msgs[index];
    if (target?.role !== "assistant" || target.event || !target.agentId) return;
    // Keep everything BEFORE this bubble; drop it and anything after.
    const keepVisible = index;
    const from = target.agentId;
    const reason = target.reason || null;
    if (index < msgs.length - 1) setGroupRewind({ kind: "regen", keepVisible, drop: msgs.length - 1 - index, from, reason });
    else void runGroupRegen(keepVisible, from, reason);
  };
  const groupEdit = (index: number, text: string) => {
    const keepVisible = index; // drop the edited owner line + everything after
    if (index < msgs.length - 1) setGroupRewind({ kind: "edit", keepVisible, text, drop: msgs.length - 1 - index });
    else void runGroupEdit(keepVisible, text);
  };
  // In a group, the same affordances rewind the ledger instead of a file.
  const regenerateHandler = isGroup ? (streaming ? undefined : groupRegenerate) : onRegenerate;
  const editHandler = isGroup ? (streaming ? undefined : groupEdit) : onEditResend;

  if (agents.isLoading) return <Loading />;

  return (
    <div className={cn("flex h-full min-h-0 overflow-hidden", !bare && "rounded-xl border border-border bg-card/40")}>
      {hideSidebar ? null : <ChatList
        pid={pid}
        agents={agentList}
        superAgentSlug={ROBY_SLUG}
        superAgentLabel={t("agents_ui.super_agent_label", { persona })}
        superAgentIcon={superAgentIcon}
        selected={selected}
        onSelect={selectChat}
        onNewChat={onNewChat}
        onNewGroup={onNewGroup}
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
            {(() => {
              const avatar = isMultiThread && a2aFaces.length ? (
                <AgentAvatarGroup faces={a2aFaces} size={compact ? 30 : 26} max={3} />
              ) : (
                <AgentAvatar {...headerFace} size={compact ? 36 : 30} />
              );
              // Tapping the face is the quick way to the agent's card/project —
              // more discoverable than the button in the row of actions.
              return onOpenInProject ? (
                <button
                  type="button"
                  onClick={onOpenInProject}
                  aria-label={t("inbox.open_in_project")}
                  className="shrink-0 rounded-full transition-opacity hover:opacity-80 active:opacity-70"
                >
                  {avatar}
                </button>
              ) : avatar;
            })()}
            {/* The session on top, WHO on the line under it. The header used to
                lead with the agent and demote the thread to a date in the meta
                line — but the agent's face is already sitting right there, and
                the date was standing in the one place the name should be. */}
            <div className="min-w-0 flex-1">
              {/* A group is one room, not an agent with many sessions — so it
                  gets a plain title, not the session switcher. */}
              {isGroup ? (
                <div className={cn(
                  "max-w-full truncate font-semibold text-foreground",
                  compact ? "text-[15px] leading-tight" : "text-sm",
                )}>
                  {convLabel || t("project.groups.title")}
                </div>
              ) : (
                <SessionPicker
                  pid={pid}
                  agentSlug={activeAgent?.slug || (selected.kind === "thread" ? "" : selected.agentSlug)}
                  isSuper={activeIsRoby}
                  selected={selected}
                  label={convLabel || t("mobile.live_session")}
                  onPick={selectChat}
                  channelScope={channelScope}
                  className={cn(
                    "max-w-full font-semibold text-foreground",
                    compact ? "text-[15px] leading-tight" : "text-sm",
                  )}
                />
              )}
              {/* Who answered, where, and when — three facts, each short. Kept
                  on one line and truncated as a whole, so a long agent name
                  cannot push the channel and the date onto a second row. */}
              <p className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-fg">
                {/* For a2a the picker above already names both agents, so the
                    meta line skips the "who" and leads with the channel. */}
                {!isMultiThread && <span className="truncate">{agentLabel}</span>}
                {/* Not on a phone: at 375px the badge and the two facts after it
                    squeezed "Roby" down to "Ro…", and the face two inches to
                    the left already says which agent this is. */}
                {activeIsRoby && !isMultiThread && !compact && (
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
            {/* Add someone: turns a 1:1 into a group, or grows an existing one.
                Same control, two meanings — the menu names which. */}
            {canAddPeople && (isGroup || addCandidates.length > 0) && (
              <div className="relative">
                <Tip content={isGroup ? t("project.groups.members_label") : t("project.groups.make_group")}>
                  <button
                    type="button"
                    aria-label={isGroup ? t("project.groups.members_label") : t("project.groups.make_group")}
                    onClick={() => setAddOpen((o) => !o)}
                    className={cn(
                      "flex items-center justify-center rounded-full text-muted-fg",
                      compact ? "size-10 active:bg-accent/60" : "size-8 hover:bg-accent/60",
                      addOpen && "bg-accent/60",
                    )}
                  >
                    <UserPlus size={compact ? 20 : 16} />
                  </button>
                </Tip>
                {addOpen && (
                  <>
                    <button type="button" aria-hidden tabIndex={-1}
                      className="fixed inset-0 z-10 cursor-default" onClick={() => setAddOpen(false)} />
                    <div className="absolute right-0 top-full z-20 mt-1 w-60 rounded-md border border-border bg-card p-1 shadow-lg">
                      {/* In a group: the current roster (each removable) then who
                          to add. In a 1:1: only who to pull in to make a group. */}
                      {isGroup && groupParticipants.length > 0 && (
                        <>
                          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-fg">
                            {t("project.groups.members_label")}
                          </p>
                          <div className="max-h-40 overflow-y-auto">
                            {groupParticipants.map((slug) => {
                              const a = agentList.find((x) => x.slug === slug);
                              return (
                                <div key={slug} className="group/mem flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/50">
                                  <AgentAvatar icon={a?.icon} emoji={a?.emoji} name={a?.name || slug} size={18} />
                                  <span className="min-w-0 flex-1 truncate">{a?.name || slug}</span>
                                  {groupParticipants.length > 1 && (
                                    <button
                                      type="button"
                                      aria-label={t("project.groups.remove_member")}
                                      title={t("project.groups.remove_member")}
                                      onClick={() => { setAddOpen(false); void removeFromGroup(slug); }}
                                      className="shrink-0 rounded p-0.5 text-muted-fg opacity-0 hover:text-destructive group-hover/mem:opacity-100"
                                    >
                                      <X size={13} />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="my-1 border-t border-border" />
                        </>
                      )}
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-fg">
                        {isGroup ? t("project.groups.add_member") : t("project.groups.make_group")}
                      </p>
                      <div className="max-h-40 overflow-y-auto">
                        {addCandidates.map((a) => (
                          <button
                            key={a.slug}
                            type="button"
                            onClick={() => { setAddOpen(false); void onPickAdd(a.slug); }}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50"
                          >
                            <AgentAvatar icon={a.icon} emoji={a.emoji} name={a.name || a.slug} size={18} />
                            <span className="truncate">{a.name || a.slug}</span>
                          </button>
                        ))}
                        {isGroup && addCandidates.length === 0 && (
                          <p className="px-2 py-1.5 text-[11px] text-muted-fg">{t("project.groups.all_in")}</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
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
                onRegenerate={regenerateHandler}
                onEdit={editHandler}
                faceFor={faceFor}
                showSpeaker={isGroup}
                nameOf={(slug) => agentList.find((a) => a.slug === slug)?.name || slug}
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
              // Every chat carries files now — Roby and project agents alike.
              // A project agent's turn goes through /agents/:slug/chat, which
              // resolves the same media dir and folds a marker into the prompt,
              // so an engine with vision renders the image and one without is
              // still told a file arrived and where it lives.
              allowFiles
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

      {/* Group regenerate / edit overwrites the messages after the target. */}
      <Dialog
        open={!!groupRewind}
        onClose={() => setGroupRewind(null)}
        title={groupRewind?.kind === "edit" ? t("project.chat.group_edit_title") : t("project.chat.group_regen_title")}
        description={t("project.chat.group_rewind_desc", { n: groupRewind?.drop ?? 0 })}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGroupRewind(null)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const r = groupRewind;
                setGroupRewind(null);
                if (!r) return;
                if (r.kind === "edit") void runGroupEdit(r.keepVisible, r.text || "");
                else void runGroupRegen(r.keepVisible, r.from, r.reason);
              }}
            >
              {groupRewind?.kind === "edit" ? t("project.chat.group_edit_confirm") : t("project.chat.group_regen_confirm")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-fg">{convLabel}</p>
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
        <Field label={t("project.chat.slug_label")}>
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
