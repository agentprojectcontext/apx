import { useState } from "react";
import { LoaderCircle, Square } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tip } from "../ui/tip";
import { useBackgroundJobs } from "../../hooks/useBackgroundJobs";
import { JobsApi } from "../../lib/api/jobs";
import { useToast } from "../Toast";
import { relativeWhen } from "../../lib/when";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { BackgroundJob } from "../../types/daemon";

/**
 * Work agents left running, on the edge of every screen.
 *
 * WHY IT IS HERE AND NOT IN A CHAT. A background job is the one piece of an
 * agent's state that belongs to no conversation. A live turn is in the thread
 * you are reading; a message is in the ledger. "Blake asked Zoya something
 * twenty minutes ago and is still waiting" is a fact about the WAITER, and the
 * waiter may be in a project you are not looking at — which is exactly when you
 * need to know, because from inside that project the agent looks idle and the
 * peer looks dead. It lived in the composer's context strip, scoped to one
 * project and folded behind a disclosure, which is three ways of being invisible.
 *
 * Drawn only when something is running. A permanent "0 jobs" chip is furniture:
 * the point of this control is that its appearance is the news.
 */
export function BackgroundJobsMenu() {
  const { jobs, mutate } = useBackgroundJobs();
  const toast = useToast();
  const [stopping, setStopping] = useState<string | null>(null);

  if (!jobs.length) return null;

  const cancel = async (job: BackgroundJob) => {
    setStopping(job.id);
    try {
      const out = await JobsApi.cancel(job.id);
      // Three outcomes worth telling apart. "Stopped" means the running turn was
      // actually reached; a job whose turn this daemon no longer holds still
      // closes, and saying so is the difference between a button that worked and
      // one that looked like it did.
      toast.info(
        out.woken
          ? t("jobs.cancelled_woken", { agent: job.from })
          : out.stopped
            ? t("jobs.cancelled")
            : t("jobs.cancelled_not_running"),
      );
    } catch (e) {
      toast.error((e as Error)?.message || t("jobs.cancel_failed"));
    } finally {
      setStopping(null);
      void mutate();
    }
  };

  return (
    <DropdownMenu>
      <Tip content={t("jobs.tip", { n: jobs.length })}>
        <DropdownMenuTrigger
          data-testid="background-jobs"
          aria-label={t("jobs.tip", { n: jobs.length })}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] tabular-nums",
            "text-emerald-700 hover:bg-accent dark:text-emerald-400",
          )}
        >
          <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" />
          {jobs.length}
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" sideOffset={6} className="max-h-[60vh] w-80 overflow-y-auto">
        {/* Base UI's GroupLabel must live inside a Group — outside one it
            throws (error #31) and takes the whole page down, which is what a
            blank screen on first open turned out to be. Not Radix. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-fg">
            {t("jobs.title")}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {jobs.map((job) => (
          <div key={job.id} className="flex items-start gap-2 px-2 py-2 text-xs">
            <div className="min-w-0 flex-1">
              {/* Who is waiting on whom — the sentence the whole record is. */}
              <p className="truncate font-medium text-foreground">
                {t("jobs.waiting", { from: job.from, to: job.to })}
              </p>
              {/* What was asked. One line: the menu is for deciding whether to
                  stop something, not for re-reading the brief. */}
              {job.body && (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-fg">{job.body}</p>
              )}
              <p className="mt-0.5 text-[10px] text-muted-fg">
                {relativeWhen(job.created_at, t as never)}
                {/* A job nobody will be woken for is a different thing, and the
                    only place that difference is visible is here. */}
                {!job.wake && ` · ${t("jobs.no_wake")}`}
              </p>
            </div>
            <Tip content={t("jobs.cancel")}>
              <button
                type="button"
                aria-label={t("jobs.cancel")}
                data-testid={`cancel-job-${job.id}`}
                disabled={stopping === job.id}
                onClick={() => void cancel(job)}
                className="mt-0.5 shrink-0 rounded p-1 text-muted-fg hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                <Square size={12} className="fill-current" />
              </button>
            </Tip>
          </div>
        ))}
        {/* Said once, at the foot, rather than on every row: cancelling reaches
            the agent, and an owner deciding whether to press it should know
            that before pressing rather than after. */}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[10px] leading-snug text-muted-fg">{t("jobs.cancel_hint")}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
