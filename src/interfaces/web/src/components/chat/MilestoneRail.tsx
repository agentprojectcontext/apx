import type React from "react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { AlertCircle, ArrowUpRight, Check, ChevronRight, Circle, Route } from "lucide-react";
import { cn } from "../../lib/cn";
import type { MilestoneState, TimelineEntry, TimelineStats } from "../../lib/api/milestones";
import { t } from "../../i18n";

// What a long chat looks like from the outside.
//
// A conversation where something real got built is unreadable afterwards: forty
// turns, hundreds of tool calls, and "where did the reel end up" buried in the
// middle of it. Scrolling back is not an answer — the reader is not looking for
// a sentence, they are looking for the SHAPE: asked, analysed, rendered,
// delivered. Four lines for four hours.
//
// So this is a rail, not a summary. Every entry is a request that actually
// happened, in the order it happened, with the outcome it had; nothing here is
// generated prose and nothing costs a model call to render. The steps the agent
// declared itself (mark_milestone) hang under the request that produced them.
//
// COLLAPSED BY DEFAULT, because the transcript is still the main thing on the
// screen and a rail that pushes it down is a second problem. The header line
// carries the only two numbers worth interrupting for — how much is still open,
// and how much failed — so a reader who needs nothing else never opens it.
//
// It does not render at all for a chat with one step and nothing wrong: a rail
// that says "1 step, done" next to the answer it is describing is furniture.

const DOT: Record<MilestoneState, string> = {
  done: "text-emerald-700 dark:text-emerald-400",
  failed: "text-rose-700 dark:text-rose-400",
  open: "text-amber-700 dark:text-amber-400",
  dropped: "text-muted-foreground",
};

function StateDot({ state }: { state: MilestoneState }) {
  const className = cn("size-3.5 shrink-0", DOT[state]);
  if (state === "done") return <Check className={className} aria-hidden />;
  if (state === "failed") return <AlertCircle className={className} aria-hidden />;
  return <Circle className={className} aria-hidden />;
}

/** The state a row REPORTS, which is not always its own: an agent that declared
 *  a failure inside a turn that otherwise answered cleanly is the more specific
 *  witness, and a row showing green over it would be actively misleading. */
function reportedState(entry: TimelineEntry): MilestoneState {
  if (entry.milestones.some((m) => m.state === "failed")) return "failed";
  if (entry.state === "failed") return "failed";
  if (entry.milestones.some((m) => m.state === "open")) return "open";
  return entry.state;
}

function clock(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function Row({ entry, href }: { entry: TimelineEntry; href?: string | null }) {
  const state = reportedState(entry);
  const tools = entry.tools;
  // `data-milestone-state`, not `data-state`: the latter is the vocabulary a
  // dead UI kit left behind, and a test contract written on it goes stale
  // silently (tests/web-guardrails.test.js). This word is ours.
  return (
    <li className="flex gap-2 py-1" data-testid="milestone-row" data-milestone-state={state}>
      <div className="flex flex-col items-center pt-0.5">
        <StateDot state={state} />
        <span className="mt-0.5 w-px flex-1 bg-border" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {/* A step names work that happened somewhere. Getting from the line to
              the conversation that produced it is the question a reader has the
              moment they spot one that failed, and without the link the answer
              is "go and find it yourself". */}
          {href ? (
            <NavLink
              to={href}
              data-testid="milestone-open-chat"
              className="group flex min-w-0 items-center gap-1 text-[12px] hover:underline"
            >
              <span className="truncate">{entry.title || t("milestones.unnamed_step")}</span>
              <ArrowUpRight className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden />
            </NavLink>
          ) : (
            <span className={cn("truncate text-[12px]", !entry.title && "text-muted-foreground")}>
              {entry.title || t("milestones.unnamed_step")}
            </span>
          )}
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {clock(entry.started_at)}
          </span>
        </div>

        {/* The one line that earns its place under a step: how much work it was,
            and whether any of it broke. */}
        {(tools?.total ?? 0) > 0 && (
          <div className="text-[11px] text-muted-foreground">
            {t("shared_ui.tools_count", { n: tools!.total })}
            {tools!.failed > 0 && (
              <span className="text-rose-700 dark:text-rose-400">
                {" · "}
                {t("shared_ui.tools_failed", { n: tools!.failed })}
              </span>
            )}
          </div>
        )}

        {state === "open" && !entry.answered && (
          <div className="text-[11px] text-amber-700 dark:text-amber-400">
            {t("milestones.never_answered")}
          </div>
        )}

        {entry.milestones.length > 0 && (
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {entry.milestones.map((m) => (
              <li
                key={m.id}
                data-testid="milestone-declared"
                className="flex items-start gap-1.5 text-[11px]"
              >
                <StateDot state={m.state} />
                <span className="min-w-0 flex-1">
                  {m.track && <span className="text-muted-foreground">{m.track} · </span>}
                  <span>{m.title}</span>
                  {m.note && <span className="text-muted-foreground"> — {m.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

interface Props {
  entries: TimelineEntry[];
  stats: TimelineStats;
  /** Open on mount. The cross-chat view wants that; a chat does not. */
  defaultOpen?: boolean;
  /**
   * Disappear when there is nothing worth following (default true).
   *
   * Right for a rail that shares space with something else — one step that went
   * fine is the answer sitting right there, and a rail describing it is
   * furniture. Wrong for a panel somebody OPENED to see this: there, vanishing
   * reads as broken, so the caller passes false and shows its own empty line.
   */
  hideWhenUneventful?: boolean;
  /** Where a step's own chat lives, when there is one to go to. Returning null
   *  leaves the row as plain text — which is right inside a chat's own panel,
   *  where every link would point at the page you are already on. */
  chatHref?: (entry: TimelineEntry) => string | null;
  /** Rendered under the last row. The cross-chat glance shows a slice and puts
   *  the way to the rest here; the full screen passes nothing. */
  footer?: React.ReactNode;
}

export function MilestoneRail({ entries, stats, defaultOpen = false, hideWhenUneventful = true, chatHref, footer }: Props) {
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? defaultOpen;

  if (!entries.length) return null;
  if (hideWhenUneventful && entries.length < 2 && stats.failed === 0 && stats.open === 0) return null;

  return (
    <div
      data-testid="milestone-rail"
      className="w-full overflow-hidden rounded-lg border border-border bg-muted/20"
    >
      <button
        type="button"
        data-testid="milestone-rail-toggle"
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <Route className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium">{t("milestones.rail_title")}</span>
        <span className="text-muted-foreground">
          ·{" "}
          {stats.total === 1
            ? t("milestones.steps_count_one")
            : t("milestones.steps_count", { n: stats.total })}
        </span>
        {stats.open > 0 && (
          <span className="text-amber-700 dark:text-amber-400">
            ·{" "}
            {stats.open === 1
              ? t("milestones.open_count_one")
              : t("milestones.open_count", { n: stats.open })}
          </span>
        )}
        {stats.failed > 0 && (
          <span className="text-rose-700 dark:text-rose-400">
            ·{" "}
            {stats.failed === 1
              ? t("milestones.failed_count_one")
              : t("milestones.failed_count", { n: stats.failed })}
          </span>
        )}
      </button>

      {open && (
        <ul className="flex flex-col border-t border-border/60 px-2.5 py-2 [&>li:last-child>div:first-child>span]:hidden">
          {entries.map((entry, i) => (
            <Row
              key={`${entry.kind}-${entry.started_at}-${i}`}
              entry={entry}
              href={chatHref?.(entry) ?? null}
            />
          ))}
        </ul>
      )}
      {open && footer ? (
        <div className="border-t border-border/60 px-2.5 py-1.5 text-[12px]">{footer}</div>
      ) : null}
    </div>
  );
}
