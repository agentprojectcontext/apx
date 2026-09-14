import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, LoaderCircle, Square } from "lucide-react";
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
import { useProjects } from "../../hooks/useProjects";
import { JobsApi } from "../../lib/api/jobs";
import { useToast } from "../Toast";
import { relativeWhen } from "../../lib/when";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { BackgroundJob } from "../../types/daemon";

/** Where a job's conversation lives. A background job IS an a2a exchange — the
 *  record carries the pair thread it opened — so the address is the one the
 *  inbox already answers to, not a new route. */
export function jobThreadUrl(job: BackgroundJob): string | null {
  if (!job.thread) return null;
  return `/inbox?channel=a2a&thread=${encodeURIComponent(job.thread)}`;
}

/**
 * A thread that cannot own a job, asking anyway.
 *
 * `threadId` unset means "count everything" — the global mount. A chat that is
 * not an a2a pair needs the third thing: scoped to itself, and its own count is
 * always nought. Passing `null` would silently turn its header chip into the
 * global counter, which is how a Telegram thread would come to claim work
 * happening between two other agents.
 */
export const NO_THREAD_JOBS = "\u0000none";

/**
 * Work agents left running, on the edge of every screen.
 *
 * WHY IT IS HERE AND NOT ONLY IN A CHAT. A background job is the one piece of
 * an agent's state that belongs to no conversation you are currently reading.
 * A live turn is in the thread in front of you; a message is in the ledger.
 * "Blake asked Zoya something twenty minutes ago and is still waiting" is a
 * fact about the WAITER, and the waiter may be in a project you are not looking
 * at — which is exactly when you need to know, because from inside that project
 * the agent looks idle and the peer looks dead.
 *
 * WHAT WAS MISSING, and it was the whole point. The count was here and the
 * CONNECTION was nowhere: a row said "Roby is waiting on magui" and did not say
 * which project, which chat, or how to get there. Manu, 2026-09-14: "arriba se
 * ve la tarea pero no se entiende bien, no dice de qué chat viene… y al abrir
 * el detalle del chat no se ve esa tarea y un botón que la abra". So a row is a
 * LINK now — it names its project and opens the thread the job is running in —
 * and the same menu is mounted a second time, scoped, inside that thread's own
 * header (`threadId`), which is where somebody reading the conversation looks.
 *
 * ALWAYS DRAWN, and that reverses what this file used to say. The rule here was
 * "drawn only when something is running — a permanent 0 chip is furniture, the
 * appearance IS the news", and Manu overruled it on 2026-09-14: "quizás estaría
 * bueno que siempre arriba esté el numerador de procesos traseros y que diga
 * cero, en gris, y cuando se pone en azul se resalta… como que tenga
 * posibilidad de estar viéndolo."
 *
 * The old rule optimised for noticing and lost something else: a control that
 * only exists while it matters cannot be LOOKED AT. You cannot answer "is
 * anything running?" by checking — you can only be told, and only if you happen
 * to be looking at the right moment. A zero you can go and read is a different
 * kind of information from a chip that is absent, even though both say nothing
 * is running: one is an answer, the other is an absence you have to trust.
 *
 * So the appearance stops being the news and the STATE carries it: muted and
 * still at zero, coloured and spinning above it. Nothing is drawn twice — the
 * same control, in two conditions.
 */
export function BackgroundJobsMenu({
  projectId,
  threadId,
  compact = false,
}: {
  /** Narrow to one project's jobs. Unset (the global mount) counts every one. */
  projectId?: string | number | null;
  /** Narrow to the jobs running IN one thread — the mount that lives in that
   *  thread's header, beside the tools toggle, where the work belongs. */
  threadId?: string | null;
  /** Sit inside a thread header: no project line on the rows (you are in it)
   *  and no jump-out arrow on the row you are already reading. */
  compact?: boolean;
} = {}) {
  const { jobs: all, mutate } = useBackgroundJobs(projectId);
  const { projects } = useProjects();
  const navigate = useNavigate();
  const toast = useToast();
  const [stopping, setStopping] = useState<string | null>(null);

  const jobs = threadId ? all.filter((j) => j.thread === threadId) : all;
  const idle = jobs.length === 0;

  const projectName = (id: BackgroundJob["project_id"]) =>
    projects.find((p) => String(p.id) === String(id))?.name || null;

  const open = (job: BackgroundJob) => {
    const url = jobThreadUrl(job);
    if (url) navigate(url);
  };

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
      <Tip content={idle ? t("jobs.tip_idle") : t("jobs.tip", { n: jobs.length })}>
        <DropdownMenuTrigger
          data-testid={threadId ? "thread-jobs" : "background-jobs"}
          data-state-running={idle ? "false" : "true"}
          aria-label={idle ? t("jobs.tip_idle") : t("jobs.tip", { n: jobs.length })}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] tabular-nums hover:bg-accent",
            // Two conditions of ONE control. At rest it recedes into the row of
            // muted glyphs beside it — there to be read, not to be noticed; with
            // work on it, it takes the colour the rest of the panel already uses
            // for left-running work, so the chip, the menu it opens and the mark
            // on the chat row are visibly the same subject.
            idle ? "text-muted-fg" : "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {/* Still at zero. A spinner over "0" would animate the claim that
              something is happening, which is the one thing this state means is
              not. Same glyph either way, so the control stays recognisable as
              itself across the change. */}
          <LoaderCircle
            size={13}
            className={cn(!idle && "animate-spin motion-reduce:animate-none")}
          />
          {/* In a thread header the count alone is a mystery glyph beside a
              wrench; the word is what makes it a status. Globally it stays a
              bare count, because it stands for work in chats you are not
              reading and shares a strip with four other icon-sized controls. */}
          {compact
            ? idle
              ? t("chat_ui.jobs_running_none")
              : jobs.length === 1
                ? t("chat_ui.jobs_running_one")
                : t("chat_ui.jobs_running", { n: jobs.length })
            : jobs.length}
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
        {/* Openable at rest, so "is anything running?" is a question you can
            ASK rather than one you have to have been watching for. An empty
            menu that says so is the answer; an empty menu that says nothing is
            a control that looks broken. */}
        {idle && (
          <p data-testid="jobs-empty" className="px-2 py-3 text-center text-[11px] text-muted-fg">
            {t("jobs.none")}
          </p>
        )}
        {jobs.map((job) => {
          const url = jobThreadUrl(job);
          const where = compact ? null : projectName(job.project_id);
          return (
            <div key={job.id} className="flex items-start gap-2 px-2 py-2 text-xs">
              {/* The row IS the way in. A status line you cannot follow leaves
                  you hunting through the sidebar for a pair of names, which is
                  the step this whole panel was supposed to remove. */}
              <button
                type="button"
                disabled={!url || compact}
                onClick={() => open(job)}
                data-testid={`open-job-${job.id}`}
                aria-label={t("jobs.open_thread")}
                className={cn(
                  "min-w-0 flex-1 rounded p-0.5 text-left",
                  url && !compact ? "group/job hover:bg-accent/50" : "cursor-default",
                )}
              >
                {/* Who is waiting on whom — the sentence the whole record is. */}
                <p className="flex items-center gap-1 truncate font-medium text-foreground">
                  <span className="truncate">{t("jobs.waiting", { from: job.from, to: job.to })}</span>
                  {url && !compact && (
                    <ArrowUpRight size={11} className="shrink-0 opacity-0 group-hover/job:opacity-70" />
                  )}
                </p>
                {/* WHICH chat this is, named rather than implied. The global
                    menu spans every project at once, so without the project a
                    row is two agent names floating free of anywhere. */}
                {where && <p className="mt-0.5 truncate text-[10px] text-muted-fg">{where}</p>}
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
              </button>
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
          );
        })}
        {/* Said once, at the foot, rather than on every row: cancelling reaches
            the agent, and an owner deciding whether to press it should know
            that before pressing rather than after. */}
        {!idle && <DropdownMenuSeparator />}
        {!idle && (
          <p className="px-2 py-1.5 text-[10px] leading-snug text-muted-fg">{t("jobs.cancel_hint")}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
