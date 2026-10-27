import type { Job } from "@apx/protocol";
import { Dialog, Icons, Spinner, Tooltip } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { elapsed, formatNumber } from "../common/format.ts";
import { cancelJob } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { turnName } from "./QueuedTurns.tsx";

const STATE_KEY: Record<Job["state"], MessageKey> = {
  queued: "job.state.queued",
  submitted: "job.state.queued",
  working: "job.state.working",
  "input-required": "job.state.waiting",
  completed: "job.state.completed",
  failed: "job.state.failed",
  canceled: "job.state.canceled",
};

/** The Background tab: running cards on top, finished ones folded below. `onOpen` shows a job's transcript. */
export function JobList({
  running,
  finished,
  now,
  onOpen,
}: {
  running: Job[];
  finished: Job[];
  now: number;
  onOpen: (job: Job) => void;
}) {
  const t = useT();
  const [showDone, setShowDone] = useState(false);
  if (!running.length && !finished.length) return <p className="running__empty">{t("running.backgroundEmpty")}</p>;
  return (
    <div className="running__list">
      {running.map((j) => (
        <JobCard key={j.id} job={j} now={now} onOpen={onOpen} />
      ))}
      {!running.length && <p className="running__empty">{t("running.nothingNow")}</p>}
      {finished.length > 0 && (
        <>
          <button
            type="button"
            className={showDone ? "jobs__fold is-open" : "jobs__fold"}
            aria-expanded={showDone}
            onClick={() => setShowDone(!showDone)}
          >
            <Icons.ChevronDown size={12} className="jobs__chev" />
            {t("running.finished", { n: finished.length })}
          </button>
          {showDone && finished.map((j) => <JobCard key={j.id} job={j} now={now} onOpen={onOpen} />)}
        </>
      )}
    </div>
  );
}

function JobCard({ job: j, now, onOpen }: { job: Job; now: number; onOpen: (job: Job) => void }) {
  const t = useT();
  const [showOutput, setShowOutput] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const thread = useData((s) => s.threads[j.thread_id]);
  const agent = useData((s) => (j.agent_id ? s.agents[j.agent_id] : undefined));
  const project = useData((s) => (j.project_id ? s.projects.find((p) => p.id === j.project_id) : undefined));
  const origin = [
    j.agent_name ?? agent?.name ?? j.agent_id ?? t("job.unknownAgent"),
    j.project_name ?? project?.name ?? j.project_id ?? t("job.unknownProject"),
    j.thread_title ?? thread?.title ?? j.thread_id,
  ].join(" · ");
  const live = !j.ended_at;
  const terminal = j.kind === "terminal";
  // A turn not started yet says what it carries: a delegation's task, a helper's result for its caller…
  const waiting = live && (j.state === "queued" || j.state === "submitted");
  const took = j.ended_at ? elapsed(j.started_at, new Date(j.ended_at).getTime()) : elapsed(j.started_at, now);
  const meta = [
    terminal ? j.cwd : j.model,
    terminal && j.exit_code !== undefined ? t("job.exit", { code: j.exit_code }) : undefined,
    j.tool_calls ? t("job.tools", { n: j.tool_calls }) : undefined,
    j.usage ? t("job.tokens", { n: formatNumber(j.usage.input + j.usage.output, { notation: "compact" }) }) : undefined,
  ].filter(Boolean);
  const activity =
    live && j.activity
      ? j.activity
      : waiting && j.from
        ? `${turnName(t, j.from)} · ${t(STATE_KEY[j.state])}`
        : t(STATE_KEY[j.state]);
  const currentProject = j.thread_project_name ?? j.thread_project_id;
  const projectContext =
    j.thread_project_id !== j.project_id && currentProject
      ? t("job.currentChatProject", { project: currentProject })
      : undefined;
  const details = [j.title, t("job.startedIn", { origin }), projectContext, activity, ...meta]
    .filter(Boolean)
    .join("\n");
  return (
    <div className={`job is-${j.state}${terminal ? " is-terminal" : ""}`}>
      <div className="job__row">
        <Tooltip
          content={
            <span className="job__hint">
              <span>{t("job.detailsHint")}</span>
              <span className="job__details">{details}</span>
            </span>
          }
          side="bottom"
        >
          <button
            type="button"
            className="job__main"
            onClick={() => (terminal ? setShowOutput(!showOutput) : onOpen(j))}
            aria-label={`${terminal ? t("job.output") : t("job.open")}: ${j.title}`}
            aria-expanded={terminal ? showOutput : undefined}
          >
            <span className="job__icon" aria-hidden="true">
              {live ? <Spinner size={12} /> : terminal ? <Icons.Terminal size={14} /> : <Icons.Bot size={14} />}
            </span>
            <span className="job__body">
              <span className="job__top">
                <span className={terminal ? "job__title is-mono" : "job__title"}>{j.title}</span>
                <span className="job__time">{took}</span>
              </span>
              <span className="job__meta job__origin">{t("job.startedIn", { origin })}</span>
              <span className="job__activity">{activity}</span>
              {meta.length > 0 && <span className="job__meta">{meta.join(" · ")}</span>}
            </span>
          </button>
        </Tooltip>
        <button
          type="button"
          className="job__stop"
          aria-label={t("job.details")}
          title={t("job.details")}
          onClick={() => setShowDetails(true)}
        >
          <Icons.Info size={12} />
        </button>
        {terminal && (
          <button
            type="button"
            className="job__stop"
            aria-label={t("job.openChat")}
            title={t("job.openChat")}
            onClick={() => onOpen(j)}
          >
            <Icons.MessageCircle size={12} />
          </button>
        )}
        {live && (
          <button
            type="button"
            className="job__stop"
            aria-label={t("job.stop")}
            title={t("job.stop")}
            onClick={() => void cancelJob(j.id)}
          >
            <Icons.Square size={12} />
          </button>
        )}
      </div>
      <Dialog
        open={showDetails}
        onOpenChange={setShowDetails}
        title={t("job.details")}
        size="sm"
        closeLabel={t("common.close")}
      >
        <textarea className="job__full-details" readOnly aria-label={t("job.details")} value={details} />
      </Dialog>
      {showOutput && <JobOutput job={j.id} live={live} />}
    </div>
  );
}

/** The end of a terminal job's output, refreshed every second while it runs. */
function JobOutput({ job, live }: { job: string; live: boolean }) {
  const t = useT();
  const [text, setText] = useState<string | undefined>();
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const r = await client.call("jobs.get", { job, max_chars: 6000 });
        if (stop) return;
        setText(r.output);
        // Follow the end of the output, like a terminal.
        requestAnimationFrame(() => {
          if (box.current) box.current.scrollTop = box.current.scrollHeight;
        });
      } catch {
        if (!stop) setText("");
      }
    };
    void pull();
    const id = live ? setInterval(pull, 1000) : undefined;
    return () => {
      stop = true;
      if (id) clearInterval(id);
    };
  }, [job, live]);
  return (
    <pre ref={box} className="job__output">
      {text === undefined ? "…" : text || t("job.noOutput")}
    </pre>
  );
}
