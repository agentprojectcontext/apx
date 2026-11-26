import type { Part, WorkflowStepState } from "@apx/protocol";
import { Button, MarkdownView, StatusIcon, type StepStatus, Tooltip } from "@apx/ui";
import { useState } from "react";
import { duration } from "../../common/format.ts";
import { useMarkdownLabels } from "../../common/useMarkdownLabels.ts";
import { workflowAction } from "../../data/actions.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";

type Workflow = Extract<Part, { type: "workflow" }>;
type Step = Workflow["phases"][number]["steps"][number];

const STATUS: Record<WorkflowStepState, StepStatus> = {
  pending: "pending",
  working: "running",
  done: "done",
  skipped: "stopped",
  failed: "failed",
  canceled: "stopped",
};

const STATE_LABEL = {
  running: "workflow.running",
  done: "workflow.done",
  failed: "workflow.failed",
  stopped: "workflow.stopped",
} as const;

/**
 * A workflow an agent started: its phases with each agent's state, how many steps ended, Stop while it runs and
 * Resume once it stopped, and its result once it ended. A step opens the chat of the agent that did it.
 */
export function WorkflowPart({ part }: { part: Workflow }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const labels = useMarkdownLabels();
  const act = (action: "stop" | "resume") => {
    setBusy(true);
    void workflowAction(part.workflow_id, action).finally(() => setBusy(false));
  };
  const canResume = part.state === "stopped" || part.state === "failed";
  return (
    <section className="plancard wfcard" aria-label={`${t("workflow.label")}: ${part.name}`}>
      <header className="wfcard__head">
        <StatusIcon status={part.state === "running" ? "running" : part.state === "done" ? "done" : "stopped"} />
        <h3 className="wfcard__name">{part.name}</h3>
        <span className="wfcard__count">{t("chat.planDone", { done: part.done, count: part.total })}</span>
        <span className="wfcard__side">
          <span className="wfcard__state">{t(STATE_LABEL[part.state])}</span>
          {part.state === "running" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("stop")}>
              {t("workflow.stop")}
            </Button>
          )}
          {canResume && (
            <Tooltip content={t("workflow.resumeHint")}>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act("resume")}>
                {t("workflow.resume")}
              </Button>
            </Tooltip>
          )}
        </span>
      </header>
      {part.phases.map((phase) => (
        <div key={phase.title} className="wfcard__phase">
          <div className="wfcard__phasehead">
            <span>{phase.title}</span>
            <span className="wfcard__count">
              {t("chat.planDone", {
                done: phase.steps.filter((s) => s.state === "done" || s.state === "skipped").length,
                count: phase.steps.length,
              })}
            </span>
          </div>
          <ul className="wfcard__steps">
            {phase.steps.map((s) => (
              <StepRow key={s.key} step={s} />
            ))}
          </ul>
        </div>
      ))}
      {part.reason && <p className="wfcard__reason">{part.reason}</p>}
      {part.result && part.state !== "running" && (
        <div className="wfcard__result">
          <Button size="sm" variant="link" onClick={() => setShowResult((v) => !v)} aria-expanded={showResult}>
            {t("workflow.result")}
          </Button>
          {showResult && <MarkdownView source={part.result} size="sm" labels={labels} />}
        </div>
      )}
    </section>
  );
}

function StepRow({ step }: { step: Step }) {
  const t = useT();
  const agent = useData((s) => (step.agent_id ? (s.agents[step.agent_id] ?? s.former[step.agent_id]) : undefined));
  const who = step.worker ?? agent?.name;
  const detail = [
    who === step.label ? undefined : who,
    step.state === "skipped" ? t("workflow.skipped") : step.state === "canceled" ? t("workflow.canceled") : undefined,
    step.ms !== undefined && step.state === "done" ? duration(step.ms) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const label = <span className="wfcard__label">{step.label}</span>;
  return (
    <li className={`wfcard__step is-${step.state}`}>
      <StatusIcon status={STATUS[step.state]} />
      {step.thread_id ? (
        <Tooltip content={t("workflow.open", { name: who ?? step.label })}>
          <Button
            size="sm"
            variant="ghost"
            className="wfcard__open"
            onClick={() => step.thread_id && go.subthread(step.thread_id)}
          >
            {label}
          </Button>
        </Tooltip>
      ) : (
        label
      )}
      {detail && <span className="wfcard__detail">{detail}</span>}
      {step.error && step.state === "failed" && (
        <Tooltip content={step.error}>
          <span className="wfcard__error">{step.error}</span>
        </Tooltip>
      )}
    </li>
  );
}
