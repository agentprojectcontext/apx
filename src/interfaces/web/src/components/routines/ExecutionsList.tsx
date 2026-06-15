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
// meta.status + meta.skipped.

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

/** Bottom pane of the detail view: scrollable list of past runs (Logs-style rows). */
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

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="shrink-0 px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
        {t("project.routines.runs_title")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {runs.isLoading && <Loading />}
        {!runs.isLoading && rows.length === 0 && (
          <div className="text-xs text-muted-fg">{t("project.routines.runs_empty")}</div>
        )}
        <ul className="space-y-1">
          {rows.map((m, i) => {
            const st = runStatus(m);
            return (
              <li key={`${m.ts}-${i}`} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs">
                {st === "ok" && <Check size={13} className="shrink-0 text-emerald-500" />}
                {st === "error" && <X size={13} className="shrink-0 text-destructive" />}
                {st === "skipped" && <Ban size={13} className="shrink-0 text-amber-500" />}
                <span className="font-mono text-muted-fg">{fmtTs(m.ts)}</span>
                <span className={cn("font-medium", st === "ok" && "text-emerald-500", st === "error" && "text-destructive", st === "skipped" && "text-amber-500")}>
                  {st === "ok" ? t("project.routines.status_ok") : st === "error" ? t("project.routines.status_error") : t("project.routines.status_skipped")}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
