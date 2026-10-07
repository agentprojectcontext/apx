import { useState } from "react";
import { Badge, Button, Input } from "../ui";
import { Tasks } from "../../lib/api";
import { useToast } from "../Toast";
import { relativeWhen } from "../../lib/when";
import { t } from "../../i18n";
import { isOwnerAssignee } from "./taskFields";
import type { TaskDecision, TaskEntry } from "../../types/daemon";

const NOTICE_TONE = { sent: "success", suppressed: "warning", failed: "danger", no_channel: "muted", unknown: "muted" } as const;

function OpenDecision({ pid, taskId, d, onChanged }: { pid: string; taskId: string; d: TaskDecision; onChanged: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const forOwner = isOwnerAssignee(d.responsible);
  const answer = async (value: string, choice: number | null) => {
    if (!value.trim()) return;
    setBusy(true);
    try { await Tasks.answerDecision(pid, taskId, d.id, value.trim(), choice); setText(""); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs" data-testid={`task-decision-${d.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warning">{forOwner ? t("tasks.dec_waiting_owner") : t("tasks.dec_waiting_agent", { who: `@${d.responsible}` })}</Badge>
        {d.asked_by && <span className="text-muted-fg">{t("tasks.dec_asked_by", { who: d.asked_by })} · {relativeWhen(d.asked_at, t as never)}</span>}
        {d.notice && <Badge tone={NOTICE_TONE[d.notice.status] ?? "muted"}>{t(`tasks.dec_notice_${d.notice.status === "unknown" ? "failed" : d.notice.status}`)}</Badge>}
      </div>
      <p className="text-sm font-medium text-fg">{d.question}</p>
      {d.recommendation && <p><span className="text-muted-fg">{t("tasks.dec_recommendation")}:</span> {d.recommendation}</p>}
      {d.blocking && <p><span className="text-muted-fg">{t("tasks.dec_blocking")}:</span> {d.blocking}</p>}
      {d.can_continue && <p><span className="text-muted-fg">{t("tasks.dec_can_continue")}:</span> {d.can_continue}</p>}
      {forOwner && (
        <div className="space-y-1.5 pt-1">
          {d.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.options.map((o, i) => (
                <Button key={o} size="sm" variant="secondary" loading={busy} data-testid={`task-decision-option-${i}`} onClick={() => answer(o, i)}>{o}</Button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <Input
              value={text}
              placeholder={t("tasks.dec_answer_ph")}
              data-testid="task-decision-answer"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void answer(text, null); }}
            />
            <Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={() => answer(text, null)}>{t("tasks.dec_answer")}</Button>
          </div>
          <p className="text-[10px] text-muted-fg">{t("tasks.dec_answer_hint")}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Decisions on this card (#58): the open ones up front, with who has to decide
 * and how the remote notice actually went; the answered ones folded below.
 */
export function TaskDecisions({ pid, task, onChanged }: { pid: string; task: TaskEntry; onChanged: () => void }) {
  const all = task.decisions ?? [];
  if (!all.length) return null;
  const open = all.filter((d) => d.state === "open");
  const closed = all.filter((d) => d.state !== "open");
  return (
    <div className="space-y-2" data-testid="task-decisions">
      {open.map((d) => <OpenDecision key={d.id} pid={pid} taskId={task.id} d={d} onChanged={onChanged} />)}
      {closed.length > 0 && (
        <details className="rounded-lg border border-border p-3 text-xs text-muted-fg">
          <summary className="cursor-pointer">{t("tasks.dec_answered", { n: closed.length })}</summary>
          {closed.map((d) => (
            <div key={d.id} className="mt-1.5">
              <span className="text-fg">{d.question}</span>{" — "}
              {d.state === "answered" ? `${d.answer}${d.answered_by ? ` (${d.answered_by})` : ""}` : `${t("tasks.dec_withdrawn")}: ${d.withdrawn_reason ?? ""}`}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
