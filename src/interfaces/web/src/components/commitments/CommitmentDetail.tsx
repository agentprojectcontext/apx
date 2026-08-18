import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Commitments, type CommitmentEntry } from "../../lib/api/commitments";
import { Badge, Button, Tip } from "../ui";
import { ReadOnlyBlock } from "../ReadOnlyBlock";
import { useToast } from "../Toast";
import { CommitmentIcon, CommitmentBadge, commitmentFace, commitmentTint, isOverdue } from "./commitmentState";
import { relativeWhen } from "../../lib/when";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * Right column: the selected promise, open by default.
 *
 * The date history is the point of this screen and gets its own section, the
 * way a routine's executions do: "moved twice, then missed" is a fact about a
 * relationship, and it only exists because the log kept every date.
 */
export function CommitmentDetail({
  commitment: c, pid, projectName, onEdit, onChanged,
}: {
  commitment: CommitmentEntry;
  pid: string;
  projectName?: string;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const face = commitmentFace(c);
  const due = c.due ? String(c.due).slice(0, 10) : null;

  const act = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true);
    try { await fn(); toast.success(label); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="commitment-detail">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-[12rem] flex-1 items-center gap-2">
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", commitmentTint(face))}>
              <CommitmentIcon face={face} className="size-4" />
            </span>
            {/* Same as tasks: the name outranks the chips for width. */}
            <h3 className="truncate text-base font-semibold" title={c.counterparty}>{c.counterparty}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="secondary" data-testid="commitment-detail-edit" onClick={onEdit}>
              <Pencil size={13} /> {t("common.edit")}
            </Button>
            {c.state === "open" && (
              <>
                <Button size="sm" variant="primary" loading={busy} onClick={() => act(() => Commitments.kept(pid, c.id), t("project.commitments.mark_kept"))}>
                  <Check size={13} /> {t("project.commitments.mark_kept")}
                </Button>
                <Tip content={t("project.commitments.mark_missed")}>
                  <Button size="sm" variant="secondary" loading={busy} aria-label={t("project.commitments.mark_missed")} onClick={() => act(() => Commitments.missed(pid, c.id), t("project.commitments.mark_missed"))}>
                    <X size={13} />
                  </Button>
                </Tip>
              </>
            )}
            <Tip content={t("project.commitments.mark_dropped")}>
              <Button size="sm" variant="destructive" loading={busy} aria-label={t("project.commitments.mark_dropped")} onClick={() => act(() => Commitments.drop(pid, c.id), t("project.commitments.dropped_toast"))}>
                <Trash2 size={13} />
              </Button>
            </Tip>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-fg">
          <CommitmentBadge face={face} />
          {projectName && <Badge tone="info">{projectName.split("/").pop() || projectName}</Badge>}
          <span className="font-mono text-[10px]">{c.id}</span>
          {due ? (
            <span className={cn(isOverdue(c) && "font-medium text-red-500")}>
              {t("project.global_tasks.field_due")} {due}
            </span>
          ) : (
            <span className="opacity-60">{t("project.commitments.no_date")}</span>
          )}
          {c.origin_channel && <span>{t("project.tasks.via")} {c.origin_channel}</span>}
          {c.renegotiated_count ? (
            <Badge tone="warning">{t("project.commitments.moved")} ×{c.renegotiated_count}</Badge>
          ) : null}
          <span title={new Date(c.created_at).toLocaleString()}>
            {t("project.commitments.promised")} {relativeWhen(c.promised_at || c.created_at, t as never)}
          </span>
          <span title={new Date(c.updated_at).toLocaleString()}>
            {t("tasks.field_updated")} {relativeWhen(c.updated_at, t as never)}
          </span>
        </div>

        <ReadOnlyBlock title={t("project.commitments.field_what")} body={c.body} />
        {c.note ? <ReadOnlyBlock title={t("project.commitments.field_note")} body={c.note} /> : null}

        {/* Every date this promise has ever had. Moving a date twice is a fact
            about the relationship, and it is only visible because it is kept. */}
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
            {t("project.commitments.history_title")}
          </div>
          {c.history?.length ? (
            <ul className="space-y-1 text-xs">
              {c.history.map((h, i) => (
                <li key={`${h.moved_at}-${i}`} className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-border bg-muted/20 px-3 py-1.5">
                  <span className="font-medium">{h.due ? String(h.due).slice(0, 10) : t("project.commitments.no_date")}</span>
                  <span className="text-muted-fg" title={new Date(h.moved_at).toLocaleString()}>
                    → {relativeWhen(h.moved_at, t as never)}
                  </span>
                  {h.note && <span className="text-muted-fg">— {h.note}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-fg">
              {t("project.commitments.history_empty")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
