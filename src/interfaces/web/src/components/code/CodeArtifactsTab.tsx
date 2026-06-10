import { useState } from "react";
import useSWR from "swr";
import { ChevronRight, Copy, RefreshCw, Trash2, FileCode2, Play } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { Empty, Spinner } from "../ui";
import { Artifacts, type ArtifactEntry, type ArtifactRunResult } from "../../lib/api/artifacts";
import { useToast } from "../Toast";

interface Props {
  pid: string;
}

function ArtifactRow({
  pid,
  entry,
  onDeleted,
}: {
  pid: string;
  entry: ArtifactEntry;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<ArtifactRunResult | null>(null);
  const toast = useToast();
  const detail = useSWR(open ? ["artifact", pid, entry.name] : null, () =>
    Artifacts.read(pid, entry.name),
  );

  // Daemon-side detection: a file is runnable if it has the exec bit OR
  // starts with a shebang. Locally we can only check the shebang from the
  // fetched content; if it's missing we still show Run (the daemon will
  // 400 cleanly and the toast surfaces the reason).
  const looksRunnable = !detail.data?.content || detail.data.content.startsWith("#!");

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.info("Copiado.");
    } catch {
      /* ignore */
    }
  };

  const run = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const r = await Artifacts.run(pid, entry.name);
      setRunResult(r);
      if (r.ok) toast.info(`exit 0 — ${r.durationMs}ms`);
      else toast.error(`exit ${r.exitCode ?? r.signal ?? "?"}${r.timedOut ? " (timeout)" : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("code_module.artifacts_delete_confirm"))) return;
    try {
      await Artifacts.remove(pid, entry.name);
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <li className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent/40"
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <FileCode2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {entry.size}b
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-2">
          <div className="flex flex-wrap items-center gap-1">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {entry.path}
            </code>
            {looksRunnable && (
              <button
                type="button"
                onClick={() => void run()}
                disabled={running}
                title={t("code_module.artifacts_run")}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium",
                  running
                    ? "bg-muted text-muted-foreground"
                    : "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300",
                )}
              >
                {running ? <Spinner size={10} /> : <Play className="size-3" />}
                {t("code_module.artifacts_run")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void copy(entry.path)}
              title={t("code_module.artifacts_copy_path")}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Copy className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              title={t("code_module.artifacts_delete")}
              className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {t("code_module.artifacts_run_hint")}{" "}
            <code className="rounded bg-muted px-1 font-mono">
              apx artifact run {entry.name}
            </code>
          </div>
          {runResult && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[10px]">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono",
                    runResult.ok
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                  )}
                >
                  exit {runResult.exitCode ?? runResult.signal ?? "?"}
                </span>
                {runResult.timedOut && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-amber-700 dark:text-amber-300">
                    timeout
                  </span>
                )}
                {runResult.truncated && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-amber-700 dark:text-amber-300">
                    truncated
                  </span>
                )}
                <span className="font-mono text-muted-foreground">
                  {runResult.durationMs}ms
                </span>
              </div>
              {runResult.stdout && (
                <pre className="max-h-32 overflow-auto rounded bg-background/60 p-2 text-[10px] leading-tight">
                  {runResult.stdout}
                </pre>
              )}
              {runResult.stderr && (
                <pre className="max-h-32 overflow-auto rounded bg-rose-500/5 p-2 text-[10px] leading-tight text-rose-700 dark:text-rose-300">
                  {runResult.stderr}
                </pre>
              )}
            </div>
          )}
          {detail.isLoading ? (
            <div className="flex justify-center py-2">
              <Spinner size={12} />
            </div>
          ) : detail.data?.content ? (
            <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-[10px] leading-tight">
              {detail.data.content}
            </pre>
          ) : null}
        </div>
      )}
    </li>
  );
}

// Artifacts tab: managed files stored under <project>/artifacts/. The agent
// puts reusable scripts here so the user can run them from a terminal.
export function CodeArtifactsTab({ pid }: Props) {
  const list = useSWR(pid ? ["artifacts", pid] : null, () => Artifacts.list(pid));
  const entries = list.data || [];
  return (
    <div className="flex h-full flex-col" data-testid="code-artifacts-tab">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          {entries.length > 0
            ? t("code_module.artifacts_count", { n: entries.length })
            : ""}
        </span>
        <button
          type="button"
          onClick={() => void list.mutate()}
          title="↻"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {list.isLoading ? <Spinner size={12} /> : <RefreshCw className="size-3" />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {entries.length === 0 ? (
          <Empty>{t("code_module.artifacts_none")}</Empty>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((a) => (
              <ArtifactRow
                key={a.name}
                pid={pid}
                entry={a}
                onDeleted={() => void list.mutate()}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
