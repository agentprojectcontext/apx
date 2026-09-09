import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { Bot, FolderTree, MessageSquare, PanelLeft, PanelRight, Terminal, X } from "lucide-react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Code, Projects, Agents } from "../../lib/api";
import { Turns } from "../../lib/api/turns";
import { subscribeTurns } from "../../lib/live";
import { queueOnSend, onChatPrefsChange } from "../../lib/chat-prefs";
import { Artifacts } from "../../lib/api/artifacts";
import { ProjectFiles } from "../../lib/api/projectFiles";
import { Empty, Loading } from "../../components/ui";
import { Tip } from "../../components/ui/tip";
import { useSetPageLabel, useSetPageActions } from "../../hooks/useNavCollapseCtx";
import { MessageList } from "../../components/chat/MessageList";
import { CodeProjectPicker, ALL_PROJECTS } from "../../components/code/CodeProjectPicker";
import { CodeSessionList } from "../../components/code/CodeSessionList";
import {
  NewCodeSessionDialog,
  SUPER_AGENT_VALUE,
  type NewSessionValues,
} from "../../components/code/NewCodeSessionDialog";
import { CodeComposer } from "../../components/code/CodeComposer";
import { CodeSidePanel } from "../../components/code/CodeSidePanel";
import { CodeFileTree } from "../../components/code/CodeFileTree";
import { CodeFileViewer } from "../../components/code/CodeFileViewer";
import { CodeTerminal } from "../../components/code/CodeTerminal";
import { InlineAskPanel, pendingAskQuestions } from "../../components/chat/InlineAskPanel";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";
import { applyStreamEvent, textOf, type ChatMsg, type QueuedTurn } from "../../hooks/useChat";
import type { CodeMode, CodeSessionRow, CodeStreamEvent, CodeTurn } from "../../lib/api/code";
import type { ActiveTurn, TurnFrame } from "../../types/daemon";

/**
 * The daemon's copy of a turn in flight, as a message to render.
 *
 * A code turn is written to the session only when it ENDS, so a panel opened
 * or refreshed mid-run had nothing to draw and showed a finished-looking
 * conversation over a daemon that was still working — the exact state where
 * you most need to see what is happening. This is that state, rebuilt: the
 * same text and the same tool rows the original pane was watching.
 */
function activeTurnMsg(turn: ActiveTurn): ChatMsg {
  return {
    role: "assistant",
    ts: turn.started_at || new Date().toISOString(),
    pending: true,
    ...(turn.model ? { model: turn.model } : {}),
    parts: (turn.parts || []).map((part) =>
      part.kind === "tool"
        ? {
            kind: "tool" as const,
            id: part.id,
            tool: part.tool,
            args: part.args ?? undefined,
            result: part.result,
            status: part.status,
          }
        : { kind: "text" as const, text: part.text, streaming: part.streaming },
    ),
  };
}

/**
 * Messages typed while a turn was running, per session.
 *
 * Module-level, not state, for the same reason the chat keeps its queue outside
 * the pane: what you queued belongs to the SESSION, not to the render that
 * happened to take it. Switch sessions and come back and it is still there,
 * waiting for the run to end.
 */
const sessionQueues = new Map<string, QueuedTurn[]>();

let queueSeq = 0;
/** A queued turn renders as the bubble it will become — what you wrote is in
 *  the conversation the moment you send it, whether or not the agent has got
 *  to it yet. Same shape and same rendering the chat's queue uses. */
function queuedTurn(text: string): QueuedTurn {
  return {
    id: `q-${++queueSeq}`,
    text,
    msg: { role: "user", parts: [{ kind: "text", text }], ts: new Date().toISOString() },
  };
}

// Hit area is wider than the visible line so the handle is comfortable to
// grab — the inner ::before line is what the user sees.
function ResizeHandle() {
  return (
    <PanelResizeHandle className="relative z-10 w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 active:bg-primary/70" />
  );
}

function ResizeHandleH() {
  return (
    <PanelResizeHandle className="relative z-10 h-px shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/50 active:bg-primary/70" />
  );
}

// Code module — OpenCode-style coding sessions in the APX web admin. Each
// project owns a list of persistent sessions; the daemon keeps the transcript
// server-side (api/code.js), so the UI just streams turns and renders them with
// the shared chat components. The right panel shows token context + the diff of
// what the session changed vs its git baseline.
export function CodeScreen() {
  const toast = useToast();
  const projects = useSWR("/api/projects", () => Projects.list());
  const projectList = useMemo(() => projects.data || [], [projects.data]);

  // Two different projects live here, and conflating them was the bug.
  //   filterPid — what the session LIST shows. "" = every project (the default).
  //   pid       — the project the OPEN session belongs to. Everything else in
  //               the module (files, terminal, artifacts, diff, agents) is
  //               scoped to this one, and it follows the session, not the filter.
  const [filterPid, setFilterPid] = useState<string>(ALL_PROJECTS);
  const [pid, setPid] = useState<string>("");
  const [sid, setSid] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // A turn is running that this pane did NOT start — another tab, `apx exec
  // --code`, or this same tab before a refresh. It is streamed to us over the
  // shared live feed instead of over our own NDJSON socket, and for everything
  // the composer decides ("is something running?") it counts exactly as busy.
  const [following, setFollowing] = useState(false);
  // What you typed while a turn was running and chose to send after it.
  const [queued, setQueued] = useState<QueuedTurn[]>([]);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [termOpen, setTermOpen] = useState(false);
  const [termInitCmd, setTermInitCmd] = useState("");
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  // Session pending delete confirmation — id AND project, since the list can
  // span projects and an id alone does not address a session.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; pid: string } | null>(null);
  // Regenerate / Edit & resend, waiting to be confirmed. Both DELETE turns —
  // the tool rows of a coding turn are a record of what really ran, and in this
  // module that can be half an hour of work — so the question is asked before
  // anything is dropped, not after. `keep` is how many turns survive.
  const [confirmRewind, setConfirmRewind] = useState<
    { keep: number; text: string; kind: "regenerate" | "edit" } | null
  >(null);
  // Only closes OUR socket. The run itself stops only when asked out loud, over
  // POST /turns/abort — closing the stream deliberately does not end it, which
  // is what lets a refresh or a second tab catch up on a turn in progress.
  const abortRef = useRef<AbortController | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkDone = useRef(false);
  // Read synchronously inside a callback that must not re-subscribe on every
  // keystroke, and inside the frame handler, which is not re-created per turn.
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  const followingRef = useRef(false);
  useEffect(() => { followingRef.current = following; }, [following]);
  const liveTurnRef = useRef<string | null>(null);
  const queueOnSendRef = useRef(queueOnSend());
  useEffect(() => onChatPrefsChange(() => { queueOnSendRef.current = queueOnSend(); }), []);

  // Open file tabs. `artifactName` marks an artifact opened for editing;
  // saves route through Artifacts.write instead of being read-only.
  type OpenFile = {
    path: string;
    content: string;
    loading?: boolean;
    artifactName?: string;
  };
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  // "chat" is the permanent tab, otherwise a file path
  const [activeTab, setActiveTab] = useState<string>("chat");

  const runInTerminal = useCallback((cmd: string) => {
    setTermOpen(true);
    setTermInitCmd(cmd);
  }, []);

  // Default to the first registered project once the list loads — only as the
  // fallback scope for a screen with no session open yet.
  useEffect(() => {
    if (!pid && projectList.length) setPid(String(projectList[0].id));
  }, [pid, projectList]);

  // The session list. Unfiltered by default: a session started by
  // `apx exec --code` belongs to whatever project that cwd resolved to, and
  // scoping the list to the project in view made those invisible.
  const sessions = useSWR(
    filterPid ? ["code-sessions", filterPid] : ["code-sessions", "all"],
    () => (filterPid ? Code.sessions.list(filterPid) : Code.sessions.listAll()),
  );

  // Rows carry their own pid only in the cross-project list; when the list is
  // already scoped, the filter IS the pid.
  const rowPid = useCallback(
    (row: CodeSessionRow) => String(row.pid ?? filterPid ?? pid),
    [filterPid, pid],
  );

  // Agents for the active project.
  const agentsData = useSWR(pid ? ["agents", pid] : null, () => Agents.list(pid));

  // Full transcript of the active session.
  const session = useSWR(pid && sid ? ["code-session", pid, sid] : null, () =>
    Code.sessions.get(pid, sid!),
  );

  // Diff vs the session's git baseline.
  const changes = useSWR(pid && sid ? ["code-changes", pid, sid] : null, () =>
    Code.changes(pid, sid!),
  );

  // Auto-select the newest session when the list loads or the filter changes.
  // Selecting also moves `pid`: the row's project is what makes it openable.
  //
  // Not while one is being created. This effect is what opens a session when
  // the id on screen names nothing in the list — and for the moment between
  // "created, selected" and "the list has been refetched", the brand new
  // session is exactly that. It threw you straight back onto the previously
  // newest session, so New session appeared to do nothing at all.
  useEffect(() => {
    if (creating) return;
    const list = sessions.data || [];
    if (!list.length) return;
    if (sid && list.some((s) => s.id === sid)) return;
    const next = list[0];
    setSid(next.id);
    setPid(rowPid(next));
  }, [sessions.data, sid, rowPid, creating]);

  // Opening another session: stop following the one we were watching, and pick
  // up whatever was queued on the one just opened. Declared BEFORE the
  // hydration effect on purpose — on a cached transcript both run in the same
  // commit, and the one that reads the new session has to be the one that wins.
  useEffect(() => {
    setFollowing(false);
    liveTurnRef.current = null;
    setQueued(sid ? sessionQueues.get(sid) || [] : []);
  }, [sid]);

  // Hydrate the message list whenever the active session's transcript loads.
  // (Not while streaming — we own the array then.)
  //
  // `active_turn` is the half the transcript cannot tell: a turn is stored only
  // when it ends, so a session with one in flight used to load as a finished
  // conversation with no sign that anything was happening. It is appended as
  // the trailing pending turn and followed from there.
  useEffect(() => {
    if (busy) return;
    if (!session.data) {
      if (!sid) setMsgs([]);
      return;
    }
    const stored = (session.data.messages as ChatMsg[]) || [];
    const live = session.data.active_turn;
    if (live) {
      liveTurnRef.current = live.turn_id;
      setFollowing(true);
      setMsgs([...stored, activeTurnMsg(live)]);
    } else {
      setMsgs(stored);
    }
  }, [session.data, sid, busy]);

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const active = session.data;
  const mode: CodeMode = active?.mode === "plan" ? "plan" : "build";
  const model = active?.model || "";

  // Narrowing the LIST. It deliberately does not touch the open session's
  // project — the auto-select effect moves to whatever the new list holds.
  const onFilterProject = (next: string) => {
    if (next === filterPid || busy) return;
    setFilterPid(next);
    setSid(null);
    setMsgs([]);
  };

  const onSelectSession = (row: CodeSessionRow) => {
    if (busy || row.id === sid) return;
    setPid(rowPid(row));
    setSid(row.id);
    setMsgs([]);
  };

  const onCreateSession = async (values: NewSessionValues) => {
    if (busy) return;
    setCreating(true);
    try {
      const created = await Code.sessions.create(values.pid, {
        title: values.title,
        agentSlug: values.agentSlug,
        mode: values.mode,
      });
      // The new session may live outside the current filter — show it rather
      // than creating something the list then hides.
      if (filterPid && filterPid !== values.pid) setFilterPid(values.pid);
      setPid(values.pid);
      setSid(created.id);
      setMsgs([]);
      setNewOpen(false);
      await sessions.mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const onRenameSession = async (row: CodeSessionRow, current: string) => {
    const title = window.prompt(t("code_module.rename"), current);
    if (!title || title === current) return;
    try {
      await Code.sessions.update(rowPid(row), row.id, { title });
      await sessions.mutate();
      if (row.id === sid) await session.mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onDeleteSession = (row: CodeSessionRow) => {
    // Not while a turn is running on it — deleting the session under a live run
    // leaves the daemon writing into a transcript that is no longer there.
    if (busy || (following && row.id === sid)) return;
    // Keep the row's project: deleting by the project in view would 404 (or,
    // worse, hit a same-id session elsewhere).
    setConfirmDelete({ id: row.id, pid: rowPid(row) });
  };

  const doDeleteSession = async () => {
    const target = confirmDelete;
    if (!target) return;
    try {
      await Code.sessions.remove(target.pid, target.id);
      if (target.id === sid) {
        setSid(null);
        setMsgs([]);
      }
      await sessions.mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Re-point THIS session at another agent. The choice is made when the session
  // is created (see NewCodeSessionDialog); this is the correction, and it lives
  // in the session's own properties panel so it cannot be mistaken for a global
  // "who am I talking to" switch — which is exactly how the old rail dropdown
  // read.
  const onAgentChange = async (slug: string) => {
    if (!sid) return;
    try {
      await Code.sessions.update(pid, sid, {
        agentSlug: slug !== SUPER_AGENT_VALUE ? slug : null,
      });
      await Promise.all([session.mutate(), sessions.mutate()]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Persist mode / model changes to the session (PATCH) + keep SWR in sync.
  const patchSession = useCallback(
    async (patch: { mode?: CodeMode; model?: string | null }) => {
      if (!sid) return;
      try {
        await Code.sessions.update(pid, sid, patch);
        await Promise.all([session.mutate(), sessions.mutate()]);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [pid, sid, session, sessions, toast],
  );

  /**
   * Stop the turn the DAEMON is running, not just the socket we read it through.
   *
   * Closing the stream has never stopped a run and must not start to: another
   * tab, or this one after a refresh, catches up on a turn in progress from the
   * daemon's own copy. So the ask is explicit, and the daemon answers by closing
   * the stream with `aborted` — which carries the partial and is not an error.
   *
   * The local abort is the fallback for the two cases the daemon cannot answer:
   * there is no live turn under that session (it finished a moment before the
   * click landed), or the request itself failed.
   */
  const stop = useCallback(async () => {
    if (pid && sid) {
      try {
        const { aborted } = await Turns.abort(pid, { code_session_id: sid });
        if (aborted) return;
      } catch {
        /* fall through to closing our own socket */
      }
    }
    abortRef.current?.abort();
    setBusy(false);
    setFollowing(false);
    liveTurnRef.current = null;
  }, [pid, sid]);

  const patchLast = useCallback((fn: (m: ChatMsg) => ChatMsg) => {
    setMsgs((curr) => {
      const copy = [...curr];
      const last = copy[copy.length - 1];
      if (last && last.role === "assistant") copy[copy.length - 1] = fn(last);
      return copy;
    });
  }, []);

  /** Park a message on this session's queue; it shows in the thread at once. */
  const enqueue = useCallback((text: string, forSid: string) => {
    const next = [...(sessionQueues.get(forSid) || []), queuedTurn(text)];
    sessionQueues.set(forSid, next);
    if (forSid === sid) setQueued(next);
  }, [sid]);

  /** Take one back before it goes out. Stop ends the turn being written; this
   *  is how you drop what you queued behind it. */
  const unqueue = useCallback((id: string) => {
    if (!sid) return;
    const next = (sessionQueues.get(sid) || []).filter((q) => q.id !== id);
    if (next.length) sessionQueues.set(sid, next);
    else sessionQueues.delete(sid);
    setQueued(next);
  }, [sid]);

  const send = async (overridePrompt?: string) => {
    const prompt = (overridePrompt ?? draft).trim();
    const fromDraft = overridePrompt === undefined;
    if (!prompt || !pid || !sid) return;

    // Writing during a run is no longer refused. It almost always means "no,
    // stop, do this instead", so by default it INTERRUPTS — the same thing a
    // new message has always done on Telegram — and queueing stays as the
    // deliberate other choice ("finish that, then do this"), remembered per
    // device. Either way the message is QUEUED: the drain effect below is what
    // actually sends it, so it survives the interruption and goes out with a
    // history that includes whatever the stopped turn wrote.
    if (busy || following) {
      if (fromDraft) setDraft("");
      enqueue(prompt, sid);
      if (!queueOnSendRef.current) void stop();
      return;
    }

    const now = new Date().toISOString();
    setMsgs((curr) => [
      ...curr,
      { role: "user", parts: [{ kind: "text", text: prompt }], ts: now },
      { role: "assistant", parts: [], ts: now, pending: true },
    ]);
    if (fromDraft) setDraft("");
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const onEvent = (ev: CodeStreamEvent) => {
      if (ev.type === "error") {
        toast.error(ev.error || t("modules_ui.code_stream_error"));
        return;
      }
      // The turn names itself before doing any work, so it can be addressed
      // (stopped, or interrupted by sending) from the first token on.
      if (ev.type === "start") {
        liveTurnRef.current = ev.turn_id || null;
        return;
      }
      // You stopped it. Everything streamed stands — it is work that really
      // happened and the daemon kept it — so this only closes the turn and
      // says so, exactly the way the local-abort path below does.
      if (ev.type === "aborted") {
        patchLast((m) => {
          const closed = applyStreamEvent(m, ev);
          return {
            ...closed,
            parts: [...closed.parts, { kind: "text", text: t("code_module.stopped") }],
          };
        });
        return;
      }
      patchLast((m) => applyStreamEvent(m, ev));
    };

    try {
      await Code.stream(pid, sid, { prompt }, onEvent, ctrl.signal);
      patchLast((m) => ({ ...m, pending: false }));
    } catch (e) {
      if (ctrl.signal.aborted) {
        patchLast((m) => ({
          ...m,
          pending: false,
          stopped: true,
          parts: [...m.parts, { kind: "text", text: t("code_module.stopped") }],
        }));
      } else {
        toast.error((e as Error).message);
        setMsgs((curr) => curr.filter((_, i) => i !== curr.length - 1));
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      liveTurnRef.current = null;
      // The transcript is refreshed BEFORE the pane stops owning the array:
      // clearing `busy` first re-runs the hydration effect against the session
      // as it was before this turn, which blanks the answer for as long as the
      // refetch takes.
      await session.mutate();
      setBusy(false);
      void sessions.mutate();
      void changes.mutate();
    }
  };

  // The live `send`, reachable from callbacks that must not be rebuilt on every
  // keystroke — the drain effect and the rewind below.
  const sendRef = useRef(send);
  sendRef.current = send;

  /**
   * Rewind the pane AND the transcript to `keep` turns, then send.
   *
   * The transcript half is not optional: the daemon rebuilds a coding turn's
   * history from the stored session, so a pane that rewound on its own would
   * ask the model to try again with the answer it is replacing still in the
   * prompt. send() appends onto whatever msgs is after the slice, so the order
   * comes out right.
   */
  const rewindAndSend = useCallback(async (keep: number, text: string) => {
    if (busy || following || !pid || !sid) return;
    try {
      await Code.sessions.truncate(pid, sid, keep);
    } catch (e) {
      toast.error((e as Error).message);
      return;
    }
    setMsgs((curr) => curr.slice(0, keep));
    // Deliberately NOT awaited. The caller is a confirm dialog that closes when
    // this resolves, and a coding turn runs for minutes — awaiting it left a
    // modal sitting on top of the very answer it had just asked for. The half
    // that can fail, and the half that destroys anything, is already done.
    void sendRef.current(text);
  }, [busy, following, pid, sid, toast]);

  /** Re-run an answer: drop it and everything under it, and re-ask the turn
   *  that produced it. */
  const askRegenerate = useCallback((index: number) => {
    const target = msgs[index];
    if (!target || target.role !== "assistant") return;
    // The user turn that produced it: the nearest one before it.
    let u = index - 1;
    while (u >= 0 && msgs[u].role !== "user") u--;
    if (u < 0) return;
    setConfirmRewind({ keep: u, text: textOf(msgs[u]), kind: "regenerate" });
  }, [msgs]);

  /** Change what you asked and ask again — everything below it goes. */
  const askEditResend = useCallback((index: number, text: string) => {
    const target = msgs[index];
    if (!target || target.role !== "user" || !text.trim()) return;
    setConfirmRewind({ keep: index, text: text.trim(), kind: "edit" });
  }, [msgs]);

  // The queue drains the moment the pane is free: what you wrote during the run
  // goes out as its own turn, in the order you wrote it, with the finished (or
  // interrupted) turn already in its history.
  useEffect(() => {
    if (busy || following || !sid || !queued.length) return;
    const [next, ...rest] = queued;
    if (rest.length) sessionQueues.set(sid, rest);
    else sessionQueues.delete(sid);
    setQueued(rest);
    void sendRef.current(next.text);
  }, [busy, following, sid, queued]);

  // Everything the pane re-reads once a turn it was watching is over. Held in a
  // ref so following a turn does not re-subscribe on every render: the SWR
  // handles are new objects each time, and the socket must not be.
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  refreshRef.current = async () => {
    await session.mutate();
    void sessions.mutate();
    void changes.mutate();
  };

  /**
   * A turn on THIS session that this pane did not start.
   *
   * The daemon pushes every live turn over the shared feed, so a second tab —
   * or this one after a refresh, or the panel while `apx exec --code` is
   * driving the same session from a terminal — watches it happen instead of
   * staring at a session that looks idle while the work goes on without it.
   */
  const onTurnFrame = useCallback((f: TurnFrame) => {
    if (busyRef.current) return;                 // our own socket already renders it
    if (!sid || f.thread_id !== sid) return;     // a code session IS its thread
    if (String(f.project_id) !== String(pid)) return;
    if (f.phase === "start") {
      liveTurnRef.current = f.turn_id;
      setFollowing(true);
      // The prompt came from somewhere else; the daemon stored it the moment it
      // arrived, so re-reading the transcript is what puts it on screen.
      void refreshRef.current();
      return;
    }
    if (f.phase === "delta") {
      if (!followingRef.current) return;
      patchLast((m) => applyStreamEvent(m, { type: "assistant_delta", delta: f.delta }));
      return;
    }
    // final / aborted / error — the turn is in the transcript now. Re-read
    // BEFORE dropping the follow, so the pane never blinks through the version
    // of the session that does not have it yet.
    void (async () => {
      await refreshRef.current();
      liveTurnRef.current = null;
      setFollowing(false);
    })();
  }, [pid, sid, patchLast]);
  useEffect(() => subscribeTurns(onTurnFrame), [onTurnFrame]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.info(t("modules_ui.code_copied"));
    } catch {
      /* ignore */
    }
  };

  const openFile = useCallback(
    (path: string) => {
      setActiveTab(path);
      setOpenFiles((prev) => {
        if (prev.some((f) => f.path === path)) return prev; // already open
        return [...prev, { path, content: "", loading: true }];
      });
      // Fetch content through the sandboxed project-files API — the path is
      // user-controlled, so it must never reach a shell.
      ProjectFiles.read(pid, path)
        .then((r) => {
          const content =
            r.encoding === "utf8" && typeof r.content === "string"
              ? r.content || t("modules_ui.code_file_empty")
              : t(r.too_large ? "files.too_large" : "files.no_preview");
          setOpenFiles((prev) =>
            prev.map((f) => (f.path === path ? { ...f, content, loading: false } : f)),
          );
        })
        .catch((e: Error) => {
          setOpenFiles((prev) =>
            prev.map((f) =>
              f.path === path ? { ...f, content: t("modules_ui.code_file_error", { msg: e.message }), loading: false } : f,
            ),
          );
        });
    },
    [pid],
  );

  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== path));
    setActiveTab((prev) => (prev === path ? "chat" : prev));
  }, []);

  // Open an artifact as an EDITABLE tab. Reuses the file-tab UI but routes
  // saves through Artifacts.write so the daemon persists the change.
  const openArtifact = useCallback(
    (name: string) => {
      const tabPath = `artifacts/${name}`;
      setActiveTab(tabPath);
      setOpenFiles((prev) => {
        if (prev.some((f) => f.path === tabPath)) return prev;
        return [...prev, { path: tabPath, content: "", loading: true, artifactName: name }];
      });
      Artifacts.read(pid, name)
        .then((r) => {
          setOpenFiles((prev) =>
            prev.map((f) =>
              f.path === tabPath ? { ...f, content: r.content, loading: false } : f,
            ),
          );
        })
        .catch((e: Error) => {
          setOpenFiles((prev) =>
            prev.map((f) =>
              f.path === tabPath ? { ...f, content: t("modules_ui.code_file_error", { msg: e.message }), loading: false } : f,
            ),
          );
        });
    },
    [pid],
  );

  // Deep-link from the project Artifacts tab (/code?pid=..&cmd=.. or &edit=..).
  // Select the requested project, then prefill the terminal with the artifact
  // command (so args like a URL can be typed) or open the file for editing.
  useEffect(() => {
    if (deepLinkDone.current) return;
    const wantPid = searchParams.get("pid");
    const cmd = searchParams.get("cmd");
    const edit = searchParams.get("edit");
    if (!wantPid || (!cmd && !edit)) return;
    // Wait until the requested project is active so the command/edit targets it.
    if (String(pid) !== String(wantPid)) {
      setPid(String(wantPid));
      return;
    }
    deepLinkDone.current = true;
    if (edit) openArtifact(edit);
    if (cmd) runInTerminal(cmd.endsWith(" ") ? cmd : cmd + " ");
    // Clear params so a refresh/back doesn't retrigger the handoff.
    setSearchParams({}, { replace: true });
  }, [searchParams, pid, openArtifact, runInTerminal, setSearchParams]);

  const saveOpenFile = useCallback(
    async (path: string, content: string) => {
      const file = openFiles.find((f) => f.path === path);
      if (!file?.artifactName) return;
      try {
        await Artifacts.write(pid, file.artifactName, content);
        setOpenFiles((prev) =>
          prev.map((f) => (f.path === path ? { ...f, content } : f)),
        );
        toast.info(t("modules_ui.code_saved"));
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [openFiles, pid, toast],
  );

  const hasProjects = !projects.isLoading && projectList.length > 0;

  // Roster of the OPEN session's project — the Context panel edits this
  // session, so a slug from another project would be dropped on save.
  const agentOptions = useMemo(() => {
    const base = [{ value: SUPER_AGENT_VALUE, label: t("modules_ui.code_super_agent"), icon: Bot, description: t("modules_ui.code_super_agent_desc") }];
    const project = (agentsData.data || []).map((a) => ({
      value: a.slug,
      label: a.name || a.slug,
      icon: Bot,
      description: a.description || a.role || a.slug,
    }));
    return [...base, ...project];
  }, [agentsData.data]);

  const turns: CodeTurn[] = useMemo(() => msgs as unknown as CodeTurn[], [msgs]);
  const activeTitle = useMemo(
    () => sessions.data?.find((s) => s.id === sid)?.title || "",
    [sessions.data, sid],
  );
  const activeProject = useMemo(() => projectList.find((p) => String(p.id) === pid), [projectList, pid]);
  useSetPageLabel(activeTitle);

  // The list spans projects unless narrowed, so rows must say which one.
  const showProject = !filterPid;

  // Detect unanswered ask_questions in the last assistant turn. Local "dismissed"
  // ref keys off the turn id so the panel re-appears for a fresh batch.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const pending = !busy && !following ? pendingAskQuestions(msgs) : null;
  const askVisible = pending && pending.turnKey !== dismissedKey;

  const submitAnswers = (compiled: string) => {
    void send(compiled);
  };

  // Stable toggle callbacks
  const toggleLeft = useCallback(() => setLeftOpen((v) => !v), []);
  const toggleTree = useCallback(() => setWorktreeOpen((v) => !v), []);
  const toggleTerm = useCallback(() => setTermOpen((v) => !v), []);
  const toggleRight = useCallback(() => setRightOpen((v) => !v), []);

  // Inject panel toggle icons into TopBar
  const pageActions = useMemo(
    () =>
      sid ? (
        <div className="flex items-center gap-0.5">
          {[
            { Icon: PanelLeft, open: leftOpen, toggle: toggleLeft, title: t("modules_ui.code_panel_sessions") },
            { Icon: FolderTree, open: worktreeOpen, toggle: toggleTree, title: t("modules_ui.code_panel_tree") },
            { Icon: Terminal, open: termOpen, toggle: toggleTerm, title: t("modules_ui.code_panel_terminal") },
            { Icon: PanelRight, open: rightOpen, toggle: toggleRight, title: t("modules_ui.code_panel_context") },
          ].map(({ Icon, open, toggle, title }) => (
            <Tip key={title} content={title}>
              <button
                type="button"
                onClick={toggle}
                data-active={open}
                className="rounded p-1 text-muted-fg transition-colors hover:bg-accent hover:text-accent-fg data-[active=true]:bg-accent data-[active=true]:text-accent-fg"
              >
                <Icon className="size-3.5" />
              </button>
            </Tip>
          ))}
        </div>
      ) : null,
    [sid, leftOpen, worktreeOpen, termOpen, rightOpen, toggleLeft, toggleTree, toggleTerm, toggleRight],
  );
  useSetPageActions(pageActions);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="screen-code">
      {projects.isLoading ? (
        <Loading />
      ) : !hasProjects ? (
        <div className="grid flex-1 place-items-center">
          <Empty>{t("code_module.no_projects")}</Empty>
        </div>
      ) : (
        <PanelGroup
          orientation="vertical"
          id="code-layout-v"
          className="min-h-0 flex-1"
        >
          {/* TOP: horizontal split across [left | tree | main | right] */}
          <Panel id="top" defaultSize={termOpen ? "55%" : "100%"} minSize="20%">
            <PanelGroup orientation="horizontal" id="code-layout" className="h-full">
              {/* Left panel: project FILTER over the session list.
                  The agent selector that used to sit at the bottom of this rail
                  is gone: it read as "who am I talking to" while silently
                  re-pointing whichever session was open. It now lives where the
                  choice is actually made (the New session dialog) and where it
                  is corrected (the session's Context panel). */}
              {leftOpen && (
                <>
                  <Panel id="left" defaultSize="14%" minSize="8%">
                    <aside className="flex h-full flex-col">
                      <div className="shrink-0 border-b border-border p-2">
                        <CodeProjectPicker
                          projects={projectList}
                          value={filterPid}
                          onChange={onFilterProject}
                          disabled={busy}
                        />
                      </div>
                      <div className="min-h-0 flex-1 overflow-hidden">
                        <CodeSessionList
                          sessions={sessions.data || []}
                          activeId={sid}
                          busy={busy}
                          showProject={showProject}
                          filtered={!!filterPid}
                          onSelect={onSelectSession}
                          onCreate={() => setNewOpen(true)}
                          onRename={onRenameSession}
                          onDelete={onDeleteSession}
                        />
                      </div>
                    </aside>
                  </Panel>
                  <ResizeHandle />
                </>
              )}

              {/* File tree panel */}
              {worktreeOpen && (
                <>
                  <Panel id="tree" defaultSize="13%" minSize="8%">
                    <div className="h-full">
                      <CodeFileTree pid={pid} projectPath={activeProject?.path} onOpenFile={openFile} />
                    </div>
                  </Panel>
                  <ResizeHandle />
                </>
              )}

              {/* Main panel: tab bar (only with files) + transcript/file viewer + composer */}
              <Panel id="main" defaultSize="50%" minSize="20%">
                <div className="flex h-full flex-col">
                  {/* Tab bar — only when files are open */}
                  {openFiles.length > 0 && (
                    <div className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border">
                      {/* Chat tab */}
                      <button
                        type="button"
                        onClick={() => setActiveTab("chat")}
                        data-active={activeTab === "chat"}
                        className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 data-[active=true]:text-foreground"
                      >
                        <MessageSquare className="size-3 shrink-0" />
                        {t("modules_ui.code_chat_tab")}
                      </button>
                      {/* File tabs */}
                      {openFiles.map((f) => {
                        const name = f.path.split("/").pop() ?? f.path;
                        const isActive = activeTab === f.path;
                        return (
                          <div
                            key={f.path}
                            data-active={isActive}
                            className="group flex shrink-0 items-center gap-1 border-r border-border px-2 py-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 data-[active=true]:text-foreground"
                          >
                            <Tip content={f.path}>
                              <button
                                type="button"
                                onClick={() => setActiveTab(f.path)}
                                className="min-w-0 max-w-[140px] truncate font-mono"
                              >
                                {name}
                              </button>
                            </Tip>
                            <Tip content={t("code_module.close")}>
                              <button
                                type="button"
                                onClick={() => closeFile(f.path)}
                                className="shrink-0 rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
                              >
                                <X className="size-2.5" />
                              </button>
                            </Tip>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Tab content */}
                  {activeTab === "chat" ? (
                    <>
                      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="code-transcript">
                        {!sid ? (
                          <div className="grid h-full place-items-center p-6">
                            <Empty>{t("code_module.pick_project")}</Empty>
                          </div>
                        ) : msgs.length || queued.length ? (
                          <MessageList
                            msgs={msgs}
                            onCopy={copyToClipboard}
                            queued={queued}
                            onUnqueue={unqueue}
                            // Not while something is running: a rewind deletes
                            // turns, and the turn in flight would append onto a
                            // transcript that had moved under it.
                            onRegenerate={busy || following ? undefined : askRegenerate}
                            onEdit={busy || following ? undefined : askEditResend}
                          />
                        ) : (
                          <div className="grid h-full place-items-center p-6">
                            <Empty>{t("code_module.empty_chat")}</Empty>
                          </div>
                        )}
                      </div>
                      {askVisible && pending && (
                        <InlineAskPanel
                          turnKey={pending.turnKey}
                          questions={pending.questions}
                          onSubmit={submitAnswers}
                          onDismiss={() => setDismissedKey(pending.turnKey)}
                          disabled={busy || following}
                        />
                      )}
                    </>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-hidden">
                      {(() => {
                        const file = openFiles.find((f) => f.path === activeTab);
                        if (!file) return null;
                        return (
                          <CodeFileViewer
                            path={file.path}
                            content={file.content}
                            loading={file.loading}
                            onSave={
                              file.artifactName
                                ? (content) => saveOpenFile(file.path, content)
                                : undefined
                            }
                          />
                        );
                      })()}
                    </div>
                  )}

                  {/* Composer — always visible at the bottom of the main column */}
                  <div className="shrink-0 border-t border-border p-2" data-testid="code-input">
                    <CodeComposer
                      value={draft}
                      onValueChange={setDraft}
                      onSubmit={() => void send()}
                      onStop={() => void stop()}
                      // A turn we are only WATCHING is still a turn running on
                      // this session: Stop has to reach it and a message still
                      // has to choose between queueing and interrupting.
                      busy={busy || following}
                      disabled={!sid}
                      mode={mode}
                      onModeChange={(m) => void patchSession({ mode: m })}
                      model={model}
                      onModelChange={(m) => void patchSession({ model: m || null })}
                    />
                  </div>
                </div>
              </Panel>

              {/* Right panel: context + changes + artifacts */}
              {rightOpen && (
                <>
                  <ResizeHandle />
                  <Panel id="right" defaultSize="22%" minSize="15%">
                    <aside className="flex h-full flex-col">
                      <CodeSidePanel
                        pid={pid}
                        turns={turns}
                        changes={changes.data}
                        changesLoading={changes.isLoading}
                        onRefreshChanges={() => void changes.mutate()}
                        session={
                          session.data
                            ? {
                                title: session.data.title,
                                mode: session.data.mode,
                                createdAt: session.data.createdAt,
                                updatedAt: session.data.updatedAt,
                                agentSlug: session.data.agentSlug ?? null,
                                projectName: activeProject?.name ?? null,
                              }
                            : null
                        }
                        agentOptions={agentOptions}
                        onAgentChange={onAgentChange}
                        busy={busy}
                        onRunInTerminal={runInTerminal}
                        onEditArtifact={openArtifact}
                      />
                    </aside>
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>

          {/* BOTTOM: terminal spanning the full width below all columns */}
          {termOpen && pid && (
            <>
              <ResizeHandleH />
              <Panel id="terminal" defaultSize="45%" minSize="10%" maxSize="80%">
                <CodeTerminal pid={pid} initCmd={termInitCmd} onClose={toggleTerm} className="h-full" />
              </Panel>
            </>
          )}
        </PanelGroup>
      )}

      <NewCodeSessionDialog
        open={newOpen}
        projects={projectList}
        defaultPid={pid || String(projectList[0]?.id ?? "")}
        busy={creating}
        onClose={() => setNewOpen(false)}
        onCreate={(values) => void onCreateSession(values)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={doDeleteSession}
        title={t("code_module.delete_confirm")}
        confirmLabel={t("common.delete")}
        testId="code-delete-session-confirm"
      />

      {/* Asking again throws away everything under the turn — in a coding
          session that is real work, with the tool rows that recorded it, and
          there is no undo. So it says how much before it does it. */}
      <ConfirmDialog
        open={!!confirmRewind}
        onClose={() => setConfirmRewind(null)}
        onConfirm={async () => {
          const target = confirmRewind;
          if (!target) return;
          await rewindAndSend(target.keep, target.text);
        }}
        title={t(
          confirmRewind?.kind === "edit"
            ? "code_module.rewind_confirm_edit"
            : "code_module.rewind_confirm_regenerate",
        )}
        description={t("code_module.rewind_confirm_desc", {
          n: String(Math.max(0, msgs.length - (confirmRewind?.keep ?? msgs.length))),
        })}
        confirmLabel={t("code_module.rewind_confirm_go")}
        testId="code-rewind-confirm"
      />
    </div>
  );
}
