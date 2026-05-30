import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Code2, Eraser } from "lucide-react";
import { Code, Projects } from "../../lib/api";
import { Badge, Button, Empty, Loading } from "../../components/ui";
import { ChatInput } from "../../components/ui/chat-input";
import { MessageList } from "../../components/chat/MessageList";
import { CodeProjectPicker } from "../../components/code/CodeProjectPicker";
import { CodeToolTrail } from "../../components/code/CodeToolTrail";
import { useToast } from "../../components/Toast";
import type { CodeStreamEvent } from "../../lib/api/code";
import type { ConversationMessage } from "../../types/daemon";
import { textOf, type ChatMsg } from "../../hooks/useChat";

// Code module — the web surface for `apx code` (the terminal coding
// assistant). There is no `/code` daemon route and we must not restart the
// daemon, so this screen rides the EXISTING project-scoped super-agent stream
// (POST /projects/:pid/super-agent/chat/stream via lib/api/code.ts). The super
// agent is APX's tool-using loop, so picking a project gives the assistant its
// working context — exactly what `apx code` does in the CLI before its REPL.
export function CodeScreen() {
  const toast = useToast();
  const projects = useSWR("/projects", () => Projects.list());
  const [pid, setPid] = useState<string>("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const projectList = useMemo(() => projects.data || [], [projects.data]);

  // Default to the first registered project once the list loads.
  useEffect(() => {
    if (!pid && projectList.length) setPid(String(projectList[0].id));
  }, [pid, projectList]);

  // Switching projects starts a fresh coding session (different context).
  const reset = () => {
    if (busy) return;
    setMsgs([]);
    setTools([]);
  };
  const onPickProject = (next: string) => {
    if (next === pid) return;
    setPid(next);
    setMsgs([]);
    setTools([]);
  };

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
  };

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || busy || !pid) return;
    const now = new Date().toISOString();
    const history: ConversationMessage[] = msgs
      .filter((m) => !m.pending)
      .map((m) => ({ role: m.role, content: textOf(m) }));

    setMsgs((curr) => [
      ...curr,
      { role: "user", parts: [{ kind: "text", text: prompt }], ts: now },
      { role: "assistant", parts: [], ts: now, pending: true },
    ]);
    setDraft("");
    setTools([]);
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let streamed = "";
    let errored = false;

    // Set the assistant turn's text to a single text part (the super-agent
    // emits the FULL accumulated text per iteration, so we overwrite).
    const setAssistantText = (text: string, pending: boolean) =>
      setMsgs((curr) => {
        const copy = [...curr];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant")
          copy[copy.length - 1] = { ...last, parts: text ? [{ kind: "text", text }] : [], pending };
        return copy;
      });

    const onEvent = (ev: CodeStreamEvent) => {
      if (ev?.type === "assistant_text" && typeof ev.text === "string" && ev.text) {
        streamed = ev.text;
        setAssistantText(streamed, true);
      } else if (ev?.type === "tool_call" || ev?.type === "tool_start" || ev?.type === "tool_result") {
        // Surface tool activity so the owner sees what the coding assistant is
        // doing (read/edit/run). Dedup consecutive identical names.
        const name = (ev.trace?.tool || ev.tool || ev.name) as string | undefined;
        if (name) {
          setTools((curr) => (curr[curr.length - 1] === name ? curr : [...curr, name]));
        }
      } else if (ev?.type === "final") {
        const finalText = ev.result?.text;
        const text = typeof finalText === "string" && finalText ? finalText : streamed;
        setAssistantText(text, false);
      } else if (ev?.type === "error") {
        errored = true;
        toast.error(ev.error || "error");
        setMsgs((curr) => {
          const copy = [...curr];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && last.pending) copy.pop();
          return copy;
        });
      }
    };

    try {
      await Code.stream(pid, { prompt, previousMessages: history }, onEvent, ctrl.signal);
    } catch (e) {
      if (ctrl.signal.aborted) {
        setAssistantText(streamed || "[detenido]", false);
      } else if (!errored) {
        toast.error((e as Error).message);
        setMsgs((curr) => {
          const copy = [...curr];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && last.pending) copy.pop();
          return copy;
        });
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
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

  return (
    <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-4xl flex-col p-4" data-testid="screen-code">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Code2 size={22} /> Code
          </h1>
          <p className="text-sm text-muted-fg">
            Asistente de código de APX. Elegí un proyecto y pedile que lea, edite o ejecute.
          </p>
        </div>
        <Badge tone="success">super-agent</Badge>
      </header>

      {projects.isLoading ? (
        <Loading />
      ) : !hasProjects ? (
        <Empty>No hay proyectos registrados. Registrá uno con `apx project add` para usar Code.</Empty>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card/40">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
            <CodeProjectPicker
              projects={projectList}
              value={pid}
              onChange={onPickProject}
              disabled={busy}
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || msgs.length === 0}
              onClick={reset}
              data-testid="code-clear"
            >
              <Eraser size={13} /> Limpiar
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto" data-testid="code-transcript">
            {msgs.length ? (
              <MessageList msgs={msgs} onCopy={copyToClipboard} />
            ) : (
              <Empty>Mandale una instrucción de código para arrancar.</Empty>
            )}
          </div>

          {busy && <CodeToolTrail tools={tools} />}

          <div
            className="border-t border-border bg-card/60 p-3"
            data-testid="code-input"
          >
            <ChatInput
              value={draft}
              onValueChange={setDraft}
              onSubmit={() => void send()}
              onStop={stop}
              busy={busy}
              disabled={!pid}
              placeholder="Pedí un cambio de código… (enter envía, shift+enter = nueva línea)"
              maxRows={12}
              footer={<span data-testid="code-target">{pid ? `proyecto #${pid} · super-agent` : "sin proyecto"}</span>}
            />
          </div>
        </div>
      )}
    </div>
  );
}
