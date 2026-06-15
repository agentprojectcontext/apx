import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { Ban, Check, X } from "lucide-react";
import { Messages } from "../../lib/api";
import type { MessageEntry } from "../../types/daemon";
import { Loading } from "../ui";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

// Execution history is derived from the ROUTINE-channel messages the runner
// logs at the end of each run (src/core/routines/runner.js) — there is no
// dedicated runs table. One system message per run carries meta.routine +
// meta.status + meta.skipped + meta.result.

type RunSt = "ok" | "error" | "skipped";

function runStatus(m: MessageEntry): RunSt {
  const meta = (m.meta || {}) as Record<string, unknown>;
  if (meta.skipped) return "skipped";
  if (meta.status === "error") return "error";
  return "ok";
}

function fmtTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function StatusIcon({ st }: { st: RunSt }) {
  if (st === "ok") return <Check size={13} className="shrink-0 text-emerald-500" />;
  if (st === "error") return <X size={13} className="shrink-0 text-destructive" />;
  return <Ban size={13} className="shrink-0 text-amber-500" />;
}

function statusLabel(st: RunSt): string {
  return st === "ok" ? t("project.routines.status_ok") : st === "error" ? t("project.routines.status_error") : t("project.routines.status_skipped");
}

function FlowBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-fg">{title}</div>
      {children}
    </div>
  );
}

type RunFlow = {
  pre?: { output?: string; exit?: number } | null;
  post?: Array<{ cmd: string; exit: number; stdout: string; stderr: string }> | null;
};

const PRE_CLS = "whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-[11px]";

/** Side panel: the full flow of the clicked run — pre → action → post. Phases
 *  that did not run are hidden; older runs (no saved flow) show just the output. */
function RunDetailPanel({ m, onClose }: { m: MessageEntry; onClose: () => void }) {
  const st = runStatus(m);
  const meta = (m.meta || {}) as Record<string, any>;
  const result = (meta.result || {}) as Record<string, any>;
  const flow = (meta.flow || null) as RunFlow | null;
  const output = String(result.reply ?? result.text ?? result.stdout ?? "");
  const err = String(result.error ?? result.stderr ?? "");
  const note = String(result.note ?? "");
  const empty = <span className="text-muted-fg">{t("project.routines.block_empty")}</span>;

  return (
    <div className="flex min-h-0 flex-col border-l border-border">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
        <div className="flex items-center gap-2 text-xs">
          <StatusIcon st={st} />
          <span className={cn("font-medium", st === "ok" && "text-emerald-500", st === "error" && "text-destructive", st === "skipped" && "text-amber-500")}>{statusLabel(st)}</span>
          <span className="font-mono text-muted-fg">{fmtTs(m.ts)}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t("project.routines.runs_close")}
          className="rounded-md p-1 text-muted-fg hover:bg-muted hover:text-foreground">
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 text-xs">
        {m.body && <div className="text-muted-fg">{m.body}</div>}

        {/* Pre-commands */}
        {flow?.pre && (
          <FlowBlock title={t("project.routines.block_pre")}>
            {flow.pre.output?.trim() ? <pre className={PRE_CLS}>{flow.pre.output}</pre> : empty}
          </FlowBlock>
        )}

        {/* Action output (agent reply / telegram message / shell stdout) */}
        <FlowBlock title={t("project.routines.runs_output")}>
          {output ? <pre className={PRE_CLS}>{output}</pre>
            : err ? <pre className="whitespace-pre-wrap break-words rounded-lg bg-destructive/10 px-3 py-2 font-mono text-[11px] text-destructive">{err}</pre>
            : note ? <div className="text-muted-fg">{note}</div>
            : empty}
        </FlowBlock>

        {/* Post-commands */}
        {flow?.post && flow.post.length > 0 && (
          <FlowBlock title={t("project.routines.block_post")}>
            <div className="space-y-1.5">
              {flow.post.map((p, i) => (
                <div key={i} className="space-y-1">
                  <div className="font-mono text-[10px] text-muted-fg">$ {p.cmd} <span className="opacity-70">· exit {p.exit}</span></div>
                  {(p.stdout || p.stderr) && <pre className={PRE_CLS}>{p.stdout || p.stderr}</pre>}
                </div>
              ))}
            </div>
          </FlowBlock>
        )}
      </div>
    </div>
  );
}

/** Bottom pane of the detail view: scrollable list of past runs; clicking one
 *  opens a side grid column with that run's details. */
export function ExecutionsList({ pid, name }: { pid: string; name: string }) {
  const runs = useSWR(
    `/projects/${pid}/routines/${name}/runs`,
    async () => {
      const msgs = await Messages.project(pid, { channel: "routine", limit: 200 });
      // Keep one row per run: the runner's end-of-run system summary.
      return msgs.filter((m) =>
        (m.meta as Record<string, unknown>)?.routine === name &&
        (m.actor_id === "apx:routine" || m.type === "system"),
      );
    },
  );
  const rows = (runs.data || []).slice(0, 50);
  const [selTs, setSelTs] = useState<string | null>(null);
  const selected = selTs ? rows.find((m) => m.ts === selTs) || null : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="shrink-0 px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
        {t("project.routines.runs_title")}
      </div>
      <div className={cn("grid min-h-0 flex-1 overflow-hidden", selected ? "grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : "grid-cols-1")}>
        {/* list */}
        <div className="min-h-0 overflow-y-auto px-4 pb-4">
          {runs.isLoading && <Loading />}
          {!runs.isLoading && rows.length === 0 && (
            <div className="text-xs text-muted-fg">{t("project.routines.runs_empty")}</div>
          )}
          <ul className="space-y-1">
            {rows.map((m, i) => {
              const st = runStatus(m);
              const active = selTs === m.ts;
              return (
                <li key={`${m.ts}-${i}`}>
                  <button
                    type="button"
                    onClick={() => setSelTs(active ? null : m.ts)}
                    aria-current={active}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors",
                      active ? "border-primary/50 bg-primary/10" : "border-border bg-muted/30 hover:border-muted-fg/40",
                    )}
                  >
                    <StatusIcon st={st} />
                    <span className="font-mono text-muted-fg">{fmtTs(m.ts)}</span>
                    <span className={cn("font-medium", st === "ok" && "text-emerald-500", st === "error" && "text-destructive", st === "skipped" && "text-amber-500")}>
                      {statusLabel(st)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* run detail (opens as a side grid column) */}
        {selected && <RunDetailPanel m={selected} onClose={() => setSelTs(null)} />}
      </div>
    </div>
  );
}
