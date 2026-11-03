import type { Part } from "@apx/protocol";
import type { PlanStep } from "@apx/protocol/task-plan";
import { StepList } from "@apx/ui";
import type { ReactNode } from "react";
import { useT } from "../../i18n/index.ts";

const STATUS = { pending: "pending", doing: "running", done: "done" } as const;

/**
 * An agent's plan as a checklist: each step pending, under way or done, with how many are done. The chat shows it under
 * the agent's answer, the task drawer on the task; a plan that is not steps shows as written (`children`).
 */
export function PlanCard({ label, steps, children }: { label: string; steps?: PlanStep[]; children?: ReactNode }) {
  const t = useT();
  const done = steps?.filter((s) => s.state === "done").length ?? 0;
  return (
    <section className="plancard" aria-label={label}>
      <h3 className="plancard__head">
        {label}
        {steps && <span className="plancard__count">{t("chat.planDone", { done, count: steps.length })}</span>}
      </h3>
      {steps ? (
        <StepList className="plancard__steps" steps={steps.map((s) => ({ label: s.step, status: STATUS[s.state] }))} />
      ) : (
        children
      )}
    </section>
  );
}

export function PlanPart({ part }: { part: Extract<Part, { type: "plan" }> }) {
  const t = useT();
  return <PlanCard label={t("chat.plan")} steps={part.steps} />;
}
