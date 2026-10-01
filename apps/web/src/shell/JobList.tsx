import type { Job } from "@apx/protocol";
import { Icons, Spinner } from "@apx/ui";
import { useState } from "react";
import { elapsed, formatNumber } from "../common/format.ts";
import { cancel } from "../data/actions.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

const STATE_KEY: Record<Job["state"], MessageKey> = {
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
  const live = !j.ended_at;
  const took = j.ended_at ? elapsed(j.started_at, new Date(j.ended_at).getTime()) : elapsed(j.started_at, now);
  const meta = [
    j.model,
    j.tool_calls ? t("job.tools", { n: j.tool_calls }) : undefined,
    j.usage ? t("job.tokens", { n: formatNumber(j.usage.input + j.usage.output, { notation: "compact" }) }) : undefined,
  ].filter(Boolean);
  return (
    <div className={`job is-${j.state}`}>
      <button type="button" className="job__main" onClick={() => onOpen(j)} title={t("job.open")}>
        <span className="job__icon" aria-hidden="true">
          {live ? (
            <Spinner size={12} />
          ) : j.kind === "terminal" ? (
            <Icons.Terminal size={14} />
          ) : (
            <Icons.Bot size={14} />
          )}
        </span>
        <span className="job__body">
          <span className="job__top">
            <span className="job__title">{j.title}</span>
            <span className="job__time">{took}</span>
          </span>
          <span className="job__activity">{live && j.activity ? j.activity : t(STATE_KEY[j.state])}</span>
          {meta.length > 0 && <span className="job__meta">{meta.join(" · ")}</span>}
        </span>
      </button>
      {live && (
        <button
          type="button"
          className="job__stop"
          aria-label={t("job.stop")}
          title={t("job.stop")}
          onClick={() => void cancel(j.thread_id)}
        >
          <Icons.Square size={12} />
        </button>
      )}
    </div>
  );
}
