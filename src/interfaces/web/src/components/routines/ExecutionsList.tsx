import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import useSWR, { mutate as globalMutate } from "swr";
import { Ban, Check, MessageSquare, X } from "lucide-react";
import { Routines } from "../../lib/api";
import type { LiveRoutineRun, RoutineRun } from "../../types/daemon";
import { subscribeRoutineRuns } from "../../lib/live";
import { Loading, Spinner, Tip } from "../ui";
import { cn } from "../../lib/cn";
import { toneText } from "../../lib/tone";
import { t } from "../../i18n";
import { MessageList } from "../chat/MessageList";
import { liveRunToChatMsgs, routineRunToChatMsgs } from "./runChat";

// A routine's runs: the one happening now, and the ones already made.
//
// Both used to be guesswork here. The history was the ROUTINE-channel ledger
// filtered client-side on `meta.routine` + a system actor — which is also what
// a "routine updated" row looks like, so editing a routine added a run to its
// own history, drawn green because an edit carries no status. That reading now
// lives in core/routines/run-log.js and arrives shaped.
//
// The run in flight came from nowhere at all: it was a boolean in the tab that
// pressed Play, so a refresh erased a routine that was still working. It now
// comes from the daemon (GET .../run) and follows the live feed, which means it
// also shows up when the SCHEDULER started it, on every open panel.

const RUN_PHASE_LABELS: Record<string, () => string> = {
  pre: () => t("project.routines.phase_pre"),
  agent: () => t("project.routines.phase_agent"),
  delivery: () => t("project.routines.phase_delivery"),
  post: () => t("project.routines.phase_post"),
};

const TRIGGER_LABELS: Record<string, () => string> = {
  manual: () => t("project.routines.trigger_manual"),
  schedule: () => t("project.routines.trigger_schedule"),
  agent: () => t("project.routines.trigger_agent"),
};

function fmtTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function StatusIcon({ st }: { st: RoutineRun["status"] }) {
  if (st === "ok") return <Check size={13} className={cn("shrink-0", toneText.emerald)} />;
  if (st === "error") return <X size={13} className="shrink-0 text-destructive" />;
  return <Ban size={13} className={cn("shrink-0", toneText.amber)} />;
}

function statusLabel(st: RoutineRun["status"]): string {
  return st === "ok" ? t("project.routines.status_ok")
    : st === "error" ? t("project.routines.status_error")
    : t("project.routines.status_skipped");
}

/** Where a run's own chat lives. Every run that went through an agent filed one
 *  — this is the link that was buried one click deep inside the detail panel. */
function chatHrefOf(pid: string, run: { conversation_id: string | null; agent_slug: string | null }): string | null {
  if (!run.conversation_id || !run.agent_slug) return null;
  return `/p/${pid}/chat?agent=${encodeURIComponent(run.agent_slug)}&conv=${encodeURIComponent(run.conversation_id)}`;
}

/** The chat link as it appears on a row: an anchor, so it opens in a new tab
 *  with the usual gestures, and stops the click from also selecting the row. */
function ChatLink({ href, compact = false }: { href: string; compact?: boolean }) {
  return (
    <Tip content={t("project.routines.open_chat")}>
      <Link
        to={href}
        onClick={(e) => e.stopPropagation()}
        aria-label={t("project.routines.open_chat")}
        data-testid="routine-open-chat"
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-fg hover:bg-muted hover:text-foreground"
      >
        <MessageSquare size={13} />
        {!compact && t("project.routines.open_chat")}
      </Link>
    </Tip>
  );
}

function FlowBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-fg">{title}</div>
      {children}
    </div>
  );
}

const PRE_CLS = "whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-[11px]";

/** Side panel: the full flow of the clicked run — pre → action → post. Phases
 *  that did not run are hidden; older runs (no saved flow) show just the output. */
function RunDetailPanel({ pid, run, onClose }: { pid: string; run: RoutineRun; onClose: () => void }) {
  const result = run.result || {};
  const output = String(result.reply ?? result.text ?? result.stdout ?? "");
  const err = String(result.error ?? result.stderr ?? "");
  const note = String(result.note ?? "");
  const empty = <span className="text-muted-fg">{t("project.routines.block_empty")}</span>;
  const chatMsgs = routineRunToChatMsgs(result, run.ts);
  const href = chatHrefOf(pid, run);

  return (
    <div className="flex min-h-0 flex-col border-l border-border">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
        <div className="flex items-center gap-2 text-xs">
          <StatusIcon st={run.status} />
          <span className={cn("font-medium", run.status === "ok" && toneText.emerald, run.status === "error" && "text-destructive", run.status === "skipped" && toneText.amber)}>{statusLabel(run.status)}</span>
          <span className="font-mono text-muted-fg">{fmtTs(run.ts)}</span>
        </div>
        <div className="flex items-center gap-1">
          {href && <ChatLink href={href} />}
          <button type="button" onClick={onClose} aria-label={t("project.routines.runs_close")}
            className="rounded-md p-1 text-muted-fg hover:bg-muted hover:text-foreground">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 text-xs">
        {run.body && <div className="text-muted-fg">{run.body}</div>}

        {run.flow?.pre && (
          <FlowBlock title={t("project.routines.block_pre")}>
            {run.flow.pre.output?.trim() ? <pre className={PRE_CLS}>{run.flow.pre.output}</pre> : empty}
          </FlowBlock>
        )}

        <FlowBlock title={chatMsgs.length ? t("project.routines.runs_chat") : t("project.routines.runs_output")}>
          {chatMsgs.length ? (
            <div data-testid="routine-run-chat" className="-mx-1">
              <MessageList msgs={chatMsgs} onCopy={() => {}} autoscroll={false} />
            </div>
          ) : output ? <pre className={PRE_CLS}>{output}</pre>
            : err ? <pre className="whitespace-pre-wrap break-words rounded-lg bg-destructive/10 px-3 py-2 font-mono text-[11px] text-destructive">{err}</pre>
            : note ? <div className="text-muted-fg">{note}</div>
            : empty}
        </FlowBlock>

        {run.flow?.post && run.flow.post.length > 0 && (
          <FlowBlock title={t("project.routines.block_post")}>
            <div className="space-y-1.5">
              {run.flow.post.map((p, i) => (
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

/** Same panel, for the run happening right now: the steps as they arrive. This
 *  is the answer to "it says running — running WHAT?", which before this had no
 *  answer anywhere, not even in the tab that started it. */
function LiveRunPanel({ pid, run, onClose }: { pid: string; run: LiveRoutineRun; onClose: () => void }) {
  const msgs = liveRunToChatMsgs(run);
  const href = chatHrefOf(pid, { conversation_id: run.conversation_id ?? null, agent_slug: run.agent_slug });
  return (
    <div className="flex min-h-0 flex-col border-l border-border" data-testid="routine-live-panel">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
        <div className="flex items-center gap-2 text-xs">
          <Spinner size={12} />
          <span className="font-medium text-primary">{RUN_PHASE_LABELS[run.phase]?.() || run.phase}</span>
          <span className="font-mono text-muted-fg">{fmtTs(run.started_at)}</span>
        </div>
        <div className="flex items-center gap-1">
          {href && <ChatLink href={href} />}
          <button type="button" onClick={onClose} aria-label={t("project.routines.runs_close")}
            className="rounded-md p-1 text-muted-fg hover:bg-muted hover:text-foreground">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 text-xs">
        <FlowBlock title={t("project.routines.runs_chat")}>
          {msgs.length ? (
            <div data-testid="routine-run-chat" className="-mx-1">
              <MessageList msgs={msgs} onCopy={() => {}} autoscroll={false} />
            </div>
          ) : (
            <div className="text-muted-fg">{t("project.routines.live_waiting")}</div>
          )}
        </FlowBlock>
      </div>
    </div>
  );
}

/** Bottom pane of the detail view: the run in flight (if any) above the runs
 *  already made. Clicking one opens it in a side grid column. */
export function ExecutionsList({ pid, name }: { pid: string; name: string }) {
  const runsKey = `/api/projects/${pid}/routines/${name}/runs`;
  const liveKey = `/api/projects/${pid}/routines/${name}/run`;
  const runs = useSWR(runsKey, () => Routines.runs(pid, name));
  // Seeded from the daemon rather than from a click, which is what makes a run
  // survive a refresh and show up on a panel that never started it.
  const seed = useSWR(liveKey, () => Routines.activeRun(pid, name).then((r) => r.run));
  const [live, setLive] = useState<LiveRoutineRun | null>(null);
  const [selTs, setSelTs] = useState<string | null>(null);

  useEffect(() => { setLive(seed.data ?? null); }, [seed.data]);

  useEffect(() => subscribeRoutineRuns((frame) => {
    if (frame.routine !== name || String(frame.project_id) !== String(pid)) return;
    if (frame.phase === "end") {
      setLive(null);
      // The run only exists in the ledger now that it is over — and the routine
      // header's "last run / last status" moved with it.
      globalMutate(runsKey);
      globalMutate(`/api/projects/${pid}/routines`);
    } else {
      setLive(frame.run);
    }
  }), [pid, name, runsKey]);

  const rows = runs.data || [];
  const selected = selTs && selTs !== "live" ? rows.find((r) => r.ts === selTs) || null : null;
  const liveSelected = selTs === "live" && live ? live : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="shrink-0 px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
        {t("project.routines.runs_title")}
      </div>
      <div className={cn("grid min-h-0 flex-1 overflow-hidden", selected || liveSelected ? "grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : "grid-cols-1")}>
        {/* list */}
        <div className="min-h-0 overflow-y-auto px-4 pb-4">
          {runs.isLoading && <Loading />}
          {!runs.isLoading && rows.length === 0 && !live && (
            <div className="text-xs text-muted-fg">{t("project.routines.runs_empty")}</div>
          )}
          <ul className="space-y-1">
            {live && (
              <li>
                <button
                  type="button"
                  onClick={() => setSelTs(selTs === "live" ? null : "live")}
                  aria-current={selTs === "live"}
                  data-testid="routine-live-row"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors",
                    selTs === "live" ? "border-primary/60 bg-primary/10" : "border-primary/40 bg-primary/5 hover:border-primary/60",
                  )}
                >
                  <Spinner size={12} />
                  <span className="font-medium text-primary">{RUN_PHASE_LABELS[live.phase]?.() || t("project.routines.running")}</span>
                  <span className="truncate text-muted-fg">
                    {TRIGGER_LABELS[live.trigger]?.() || live.trigger}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-muted-fg">{fmtTs(live.started_at)}</span>
                </button>
              </li>
            )}
            {rows.map((run, i) => {
              const active = selTs === run.ts;
              const href = chatHrefOf(pid, run);
              return (
                <li key={`${run.ts}-${i}`}>
                  {/* The link is a sibling of the row button, not inside it: a
                      button in a button is invalid and swallows the click. */}
                  <div className={cn(
                    "flex items-center gap-1 rounded-md border pr-1 transition-colors",
                    active ? "border-primary/50 bg-primary/10" : "border-border bg-muted/30 hover:border-muted-fg/40",
                  )}>
                    <button
                      type="button"
                      onClick={() => setSelTs(active ? null : run.ts)}
                      aria-current={active}
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-xs"
                    >
                      <StatusIcon st={run.status} />
                      <span className="font-mono text-muted-fg">{fmtTs(run.ts)}</span>
                      <span className={cn("font-medium", run.status === "ok" && toneText.emerald, run.status === "error" && "text-destructive", run.status === "skipped" && toneText.amber)}>
                        {statusLabel(run.status)}
                      </span>
                    </button>
                    {href && <ChatLink href={href} compact />}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* run detail (opens as a side grid column) */}
        {liveSelected && <LiveRunPanel pid={pid} run={liveSelected} onClose={() => setSelTs(null)} />}
        {!liveSelected && selected && <RunDetailPanel pid={pid} run={selected} onClose={() => setSelTs(null)} />}
      </div>
    </div>
  );
}
