import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Code, Projects } from "../../lib/api";
import { Badge, Empty, Loading } from "../../components/ui";
import { useSetPageLabel } from "../../hooks/useNavCollapseCtx";
import { MessageList } from "../../components/chat/MessageList";
import { CodeProjectPicker } from "../../components/code/CodeProjectPicker";
import { CodeSessionList } from "../../components/code/CodeSessionList";
import { CodeComposer } from "../../components/code/CodeComposer";
import { CodeSidePanel } from "../../components/code/CodeSidePanel";
import { InlineAskPanel, pendingAskQuestions } from "../../components/chat/InlineAskPanel";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";
import { applyStreamEvent, textOf, type ChatMsg } from "../../hooks/useChat";
import type { CodeMode, CodeStreamEvent, CodeTurn } from "../../lib/api/code";

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
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Default to the first registered project once the list loads.
  useEffect(() => {
    if (!pid && projectList.length) setPid(String(projectList[0].id));
  }, [pid, projectList]);

  // Sessions for the active project.
  const sessions = useSWR(pid ? ["code-sessions", pid] : null, () =>
    Code.sessions.list(pid),
  );

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
      const created = await Code.sessions.create(pid, { title: t("code_module.untitled") });
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
        toast.error(ev.error || "error");
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
      toast.info("Copiado.");
    } catch {
      /* ignore */
    }
  };

  const hasProjects = !projects.isLoading && projectList.length > 0;
  const turns: CodeTurn[] = useMemo(() => msgs as unknown as CodeTurn[], [msgs]);
  const activeTitle = useMemo(
    () => sessions.data?.find((s) => s.id === sid)?.title || "",
    [sessions.data, sid],
  );
  useSetPageLabel(activeTitle);

  // Detect unanswered ask_questions in the last assistant turn. Local "dismissed"
  // ref keys off the turn id so the panel re-appears for a fresh batch.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const pending = !busy ? pendingAskQuestions(msgs) : null;
  const askVisible = pending && pending.turnKey !== dismissedKey;

  const submitAnswers = (compiled: string) => {
    void send(compiled);
  };

  return (
    <div className="flex h-full min-h-0" data-testid="screen-code">
      {projects.isLoading ? (
        <Loading />
      ) : !hasProjects ? (
        <div className="grid flex-1 place-items-center">
          <Empty>{t("code_module.no_projects")}</Empty>
        </div>
      ) : (
        <>
          {/* Left: project picker + session list */}
          <aside className="flex w-52 shrink-0 flex-col border-r border-border">
            <div className="shrink-0 border-b border-border p-2">
              <CodeProjectPicker
                projects={projectList}
                value={pid}
                onChange={onPickProject}
                disabled={busy}
              />
            </div>
            <CodeSessionList
              sessions={sessions.data || []}
              activeId={sid}
              busy={busy}
              onSelect={onSelectSession}
              onCreate={onCreateSession}
              onRename={onRenameSession}
              onDelete={onDeleteSession}
            />
            <div className="shrink-0 border-t border-border px-3 py-2">
              <Badge tone="success">{t("code_module.badge")}</Badge>
            </div>
          </aside>

          {/* Center: transcript + composer */}
          <main className="flex min-w-0 flex-1 flex-col">
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
            <div className="border-t border-border bg-card/60 p-3" data-testid="code-input">
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
          </main>

          {/* Right: context + changes */}
          <aside className="hidden w-72 shrink-0 flex-col border-l border-border lg:flex">
            <CodeSidePanel
              pid={pid}
              turns={turns}
              changes={changes.data}
              changesLoading={changes.isLoading}
              onRefreshChanges={() => void changes.mutate()}
            />
          </aside>
        </>
      )}
    </div>
  );
}
