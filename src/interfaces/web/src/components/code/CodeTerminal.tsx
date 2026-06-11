import { useState, useRef, useEffect } from "react";
import { Terminal as TerminalIcon, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { http } from "../../lib/http";

interface Line {
  type: "cmd" | "out" | "err";
  text: string;
}

export function CodeTerminal({ pid, className, initCmd }: { pid: string; className?: string; initCmd?: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  // Pre-fill input when a command is pushed from parent (e.g. artifact run).
  useEffect(() => {
    if (!initCmd) return;
    setInput(initCmd);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [initCmd]);

  const run = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    setHistory((h) => [trimmed, ...h.slice(0, 49)]);
    setHistIdx(-1);
    setLines((l) => [...l, { type: "cmd", text: `$ ${trimmed}` }]);
    setBusy(true);
    try {
      const r = await http.post<{ ok: boolean; stdout: string; stderr: string; exit_code: number; cwd: string }>(
        "/run",
        { cmd: trimmed, project: pid },
      );
      if (r.stdout) setLines((l) => [...l, { type: "out", text: r.stdout }]);
      if (r.stderr) setLines((l) => [...l, { type: "err", text: r.stderr }]);
    } catch (e) {
      setLines((l) => [...l, { type: "err", text: String((e as Error).message) }]);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void run(input);
      setInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setInput(history[next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setInput(next === -1 ? "" : (history[next] ?? ""));
    }
  };

  return (
    <div className={cn("flex h-48 flex-col bg-background/95", className)} data-testid="code-terminal">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1">
        <TerminalIcon className="size-3 text-muted-foreground" />
        <span className="flex-1 text-[11px] text-muted-foreground">Terminal</span>
        <button
          type="button"
          onClick={() => setLines([])}
          title="Limpiar"
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-1 font-mono text-[11px] leading-snug cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-all",
              l.type === "cmd" && "text-emerald-400",
              l.type === "err" && "text-rose-400",
              l.type === "out" && "text-foreground/90",
            )}
          >
            {l.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex shrink-0 items-center border-t border-border px-3 py-1">
        <span className="mr-2 text-[11px] text-emerald-400 font-mono">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={busy}
          placeholder={busy ? "ejecutando…" : "comando…"}
          className="flex-1 bg-transparent font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
