import type { Job, JobFrom } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { elapsed } from "../common/format.ts";
import { type T, useT } from "../i18n/index.ts";

/** A queued turn named by what it carries ("Alma's result", "Your message"), as the core summed it up. */
export function turnName(t: T, from: JobFrom | undefined): string {
  const name = from?.name ?? "";
  switch (from?.kind) {
    case "user":
      return t("turn.from.user");
    case "input_answer":
      return t("turn.from.inputAnswer");
    case "agent":
    case "channel":
      return t("turn.from.message", { name });
    case "delegation_result":
      return t("turn.from.result", { name });
    case "task_result":
      return t("turn.from.task", { name });
    case "routine":
      return t("turn.from.routine", { name });
    case "surface":
      return t("turn.from.surface", { name });
    case "job":
    case "terminal":
      return t("turn.from.command");
    case "go_on":
      return t("turn.from.goOn");
    case "stalled_task":
      return t("turn.from.stalledTask");
    default:
      return t("turn.from.other");
  }
}

/** A chat's turns waiting behind the one in progress, nested under it in the popover and the chat's processes. */
export function QueuedTurns({ turns, now, onOpen }: { turns: Job[]; now: number; onOpen?: () => void }) {
  const t = useT();
  if (!turns.length) return null;
  return (
    <div className="turns">
      {turns.map((j) => {
        const body = (
          <>
            <Icons.Clock size={14} className="turns__icon" aria-hidden="true" />
            <span className="turns__name">{turnName(t, j.from)}</span>
            <span className="turns__state">{t("job.state.queued")}</span>
            <span className="turns__time">{elapsed(j.started_at, now)}</span>
          </>
        );
        return onOpen ? (
          <button key={j.id} type="button" className="turns__row" title={t("turn.queuedAfter")} onClick={onOpen}>
            {body}
          </button>
        ) : (
          <div key={j.id} className="turns__row" title={t("turn.queuedAfter")}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
