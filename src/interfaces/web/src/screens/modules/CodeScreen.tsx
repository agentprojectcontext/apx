import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Bot, FolderTree, MessageSquare, PanelLeft, PanelRight, Terminal, X } from "lucide-react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Code, Projects, Agents } from "../../lib/api";
import { Artifacts } from "../../lib/api/artifacts";
import { http } from "../../lib/http";
import { Empty, Loading } from "../../components/ui";
import { Tip } from "../../components/ui/tip";
import { UiSelect } from "../../components/UiSelect";
import { useSetPageLabel, useSetPageActions } from "../../hooks/useNavCollapseCtx";
import { MessageList } from "../../components/chat/MessageList";
import { CodeProjectPicker } from "../../components/code/CodeProjectPicker";
import { CodeSessionList } from "../../components/code/CodeSessionList";
import { CodeComposer } from "../../components/code/CodeComposer";
import { CodeSidePanel } from "../../components/code/CodeSidePanel";
import { CodeFileTree } from "../../components/code/CodeFileTree";
import { CodeFileViewer } from "../../components/code/CodeFileViewer";
import { CodeTerminal } from "../../components/code/CodeTerminal";
import { InlineAskPanel, pendingAskQuestions } from "../../components/chat/InlineAskPanel";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";
import { applyStreamEvent, textOf, type ChatMsg } from "../../hooks/useChat";
import type { CodeMode, CodeStreamEvent, CodeTurn } from "../../lib/api/code";

// Suppress unused import warning for textOf (kept for consumers)
void textOf;

const SUPER_AGENT_VALUE = "super-agent";

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
  const projects = useSWR("/projects", () => Projects.list());
  const projectList = useMemo(() => projects.data || [], [projects.data]);

  const [pid, setPid] = useState<string>("");
  const [sid, setSid] = useState<string | null>(null);
  const [agentSlug, setAgentSlug] = useState<string>(SUPER_AGENT_VALUE);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [termOpen, setTermOpen] = useState(false);
  const [termInitCmd, setTermInitCmd] = useState("");
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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

  // Default to the first registered project once the list loads.
  useEffect(() => {
    if (!pid && projectList.length) setPid(String(projectList[0].id));
  }, [pid, projectList]);

  // Sessions for the active project.
  const sessions = useSWR(pid ? ["code-sessions", pid] : null, () =>
    Code.sessions.list(pid),
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

  // Auto-select the newest session when the list loads / project changes.
  useEffect(() => {
    const list = sessions.data || [];
    if (!sid && list.length) setSid(list[0].id);
    if (sid && list.length && !list.some((s) => s.id === sid)) setSid(list[0]?.id ?? null);
  }, [sessions.data, sid]);

  // Sync agentSlug from the active session when it loads.
  useEffect(() => {
    if (session.data) setAgentSlug(session.data.agentSlug || SUPER_AGENT_VALUE);
  }, [session.data]);

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

  const onPickProject = (next: string) => {
    if (next === pid || busy) return;
    setPid(next);
    setSid(null);
    setMsgs([]);
  };

  const onSelectSession = (id: string) => {
    if (busy || id === sid) return;
    setSid(id);
    setMsgs([]);
  };

  const onCreateSession = async () => {
    if (!pid || busy) return;
    try {
      const created = await Code.sessions.create(pid, {
        title: t("code_module.untitled"),
        agentSlug: agentSlug !== SUPER_AGENT_VALUE ? agentSlug : null,
      });
      await sessions.mutate();
      setSid(created.id);
      setMsgs([]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onRenameSession = async (id: string, current: string) => {
    const title = window.prompt(t("code_module.rename"), current);
    if (!title || title === current) return;
    try {
      await Code.sessions.update(pid, id, { title });
      await sessions.mutate();
      if (id === sid) await session.mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onDeleteSession = async (id: string) => {
    if (busy) return;
    if (!window.confirm(t("code_module.delete_confirm"))) return;
    try {
      await Code.sessions.remove(pid, id);
      if (id === sid) {
        setSid(null);
        setMsgs([]);
      }
      await sessions.mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Persist mode / model changes to the session (PATCH) + keep SWR in sync.
  const onAgentChange = async (slug: string) => {
    setAgentSlug(slug);
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
      // Fetch content async
      http
        .post<{ ok: boolean; stdout: string; stderr: string }>("/run", {
          cmd: `cat "${path}"`,
          project: pid,
        })
        .then((r) => {
          const content = r.stdout || r.stderr || t("modules_ui.code_file_empty");
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

  const agentOptions = useMemo(() => {
    const base = [{ value: SUPER_AGENT_VALUE, label: t("modules_ui.code_super_agent"), icon: Bot, description: t("modules_ui.code_super_agent_desc") }];
    const project = (agentsData.data || []).map((a) => ({
      value: a.slug,
      label: a.slug,
      icon: Bot,
      description: a.description || a.role || undefined,
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
              {/* Left panel: session list + agent selector */}
              {leftOpen && (
                <>
                  <Panel id="left" defaultSize="14%" minSize="8%">
                    <aside className="flex h-full flex-col">
                      <div className="shrink-0 border-b border-border p-2">
                        <CodeProjectPicker
                          projects={projectList}
                          value={pid}
                          onChange={onPickProject}
                          disabled={busy}
                        />
                      </div>
                      <div className="min-h-0 flex-1 overflow-hidden">
                        <CodeSessionList
                          sessions={sessions.data || []}
                          activeId={sid}
                          busy={busy}
                          onSelect={onSelectSession}
                          onCreate={onCreateSession}
                          onRename={onRenameSession}
                          onDelete={onDeleteSession}
                        />
                      </div>
                      <div className="shrink-0 border-t border-border p-2">
                        <UiSelect
                          value={agentSlug}
                          onChange={onAgentChange}
                          options={agentOptions}
                          disabled={busy}
                          showIcon={true}
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
                              }
                            : null
                        }
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
    </div>
  );
}
