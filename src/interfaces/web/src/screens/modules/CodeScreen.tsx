import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { Bot, FolderTree, MessageSquare, PanelLeft, PanelRight, Terminal, X } from "lucide-react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Code, Projects, Agents } from "../../lib/api";
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
import { applyStreamEvent, textOf, type ChatMsg } from "../../hooks/useChat";
import type { CodeMode, CodeSessionRow, CodeStreamEvent, CodeTurn } from "../../lib/api/code";

// Suppress unused import warning for textOf (kept for consumers)
void textOf;

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
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [termOpen, setTermOpen] = useState(false);
  const [termInitCmd, setTermInitCmd] = useState("");
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  // Session pending delete confirmation — id AND project, since the list can
  // span projects and an id alone does not address a session.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; pid: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkDone = useRef(false);

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
  useEffect(() => {
    const list = sessions.data || [];
    if (!list.length) return;
    if (sid && list.some((s) => s.id === sid)) return;
    const next = list[0];
    setSid(next.id);
    setPid(rowPid(next));
  }, [sessions.data, sid, rowPid]);

  // Hydrate the message list whenever the active session's transcript loads.
  // (Not while streaming — we own the array then.)
  useEffect(() => {
    if (busy) return;
    if (session.data) setMsgs((session.data.messages as ChatMsg[]) || []);
    else if (!sid) setMsgs([]);
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
    if (busy) return;
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

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
  };

  const patchLast = (fn: (m: ChatMsg) => ChatMsg) =>
    setMsgs((curr) => {
      const copy = [...curr];
      const last = copy[copy.length - 1];
      if (last && last.role === "assistant") copy[copy.length - 1] = fn(last);
      return copy;
    });

  const send = async (overridePrompt?: string) => {
    const prompt = (overridePrompt ?? draft).trim();
    if (!prompt || busy || !pid || !sid) return;
    const now = new Date().toISOString();
    setMsgs((curr) => [
      ...curr,
      { role: "user", parts: [{ kind: "text", text: prompt }], ts: now },
      { role: "assistant", parts: [], ts: now, pending: true },
    ]);
    setDraft("");
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const onEvent = (ev: CodeStreamEvent) => {
      if (ev.type === "error") {
        toast.error(ev.error || t("modules_ui.code_stream_error"));
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
          parts: [...m.parts, { kind: "text", text: t("code_module.stopped") }],
        }));
      } else {
        toast.error((e as Error).message);
        setMsgs((curr) => curr.filter((_, i) => i !== curr.length - 1));
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
      // Server persisted the turn; refresh derived views.
      void session.mutate();
      void sessions.mutate();
      void changes.mutate();
    }
  };

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
  const pending = !busy ? pendingAskQuestions(msgs) : null;
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
                        ) : msgs.length ? (
                          <MessageList msgs={msgs} onCopy={copyToClipboard} />
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
                          disabled={busy}
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
                      onStop={stop}
                      busy={busy}
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
    </div>
  );
}
