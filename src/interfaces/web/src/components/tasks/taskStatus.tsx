import { Loader2, CheckCircle2, XCircle, Clock, CircleDot, HelpCircle, Car } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneDot, toneText, toneTint } from "../../lib/tone";
import type { TaskCategory, TaskEntry, TaskStatus } from "../../types/daemon";

type Meta = { labelKey: string; color: string; dot: string; tint: string; Icon: typeof Clock; spin?: boolean };

// Single source of truth for how each workflow status looks. Reused by the
// task list, detail panel and the floor/overview.
const STATUS_META: Record<TaskStatus, Meta> = {
  pending:   { labelKey: "tasks.status_pending",   color: toneText.amber,  dot: toneDot.amber,  tint: toneTint.amber,  Icon: CircleDot },
  running:   { labelKey: "tasks.status_running",   color: toneText.sky,    dot: toneDot.sky,    tint: toneTint.sky,    Icon: Loader2, spin: true },
  in_review: { labelKey: "tasks.status_in_review", color: toneText.violet, dot: toneDot.violet, tint: toneTint.violet, Icon: Clock },
  blocked:   { labelKey: "tasks.status_blocked",   color: toneText.slate,  dot: toneDot.slate,  tint: toneTint.slate,  Icon: HelpCircle },
};

export const TASK_STATUS_ORDER: TaskStatus[] = ["pending", "running", "in_review", "blocked"];

// Effective status for display: closed tasks render as done/dropped regardless
// of their last open sub-status.
export function effectiveStatus(task: TaskEntry): TaskStatus | "done" | "dropped" {
  if (task.state === "done") return "done";
  if (task.state === "dropped") return "dropped";
  return task.status ?? "pending";
}

export function statusLabel(status: TaskStatus): string {
  return t(STATUS_META[status].labelKey as never);
}

/** Background+foreground for the little square that carries the icon in lists. */
export function statusTint(status: TaskStatus | "done" | "dropped"): string {
  if (status === "done") return toneTint.emerald;
  if (status === "dropped") return "bg-muted text-muted-foreground";
  return STATUS_META[status].tint;
}

export function StatusIcon({ status, className }: { status: TaskStatus | "done" | "dropped"; className?: string }) {
  if (status === "done") return <CheckCircle2 className={cn("size-4", toneText.emerald, className)} />;
  if (status === "dropped") return <XCircle className={cn("size-4 text-muted-foreground", className)} />;
  const m = STATUS_META[status];
  return <m.Icon className={cn("size-4", m.color, m.spin && "animate-spin", className)} />;
}

export function StatusBadge({ status }: { status: TaskStatus | "done" | "dropped" }) {
  const label =
    status === "done" ? t("tasks.done_label")
    : status === "dropped" ? t("tasks.dropped_label")
    : statusLabel(status);
  const color =
    status === "done" ? cn(toneText.emerald, "border-current/30")
    : status === "dropped" ? "text-muted-foreground border-border"
    : cn(STATUS_META[status].color, "border-current/30");
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium", color)}>
      <StatusIcon status={status} className="size-3" />
      {label}
    </span>
  );
}

export function StatusDot({ status }: { status: TaskStatus }) {
  return <span className={cn("size-2 rounded-full", STATUS_META[status].dot)} />;
}

// ── Category ────────────────────────────────────────────────────────────────
// What KIND of task, next to the status icon that says how it is going. The
// two answer different questions and both belong on the row: a trip errand is
// a trip errand whether it is pending or blocked.
const CATEGORY_META: Record<TaskCategory, { labelKey: string; Icon: typeof Car } | null> = {
  // "general" draws nothing: an icon on every row carries no information.
  general: null,
  trip: { labelKey: "tasks.category_trip", Icon: Car },
};

export function categoryLabel(category: TaskCategory): string {
  const meta = CATEGORY_META[category];
  return meta ? t(meta.labelKey as never) : t("tasks.category_general");
}

/** The little mark that says this is an errand. Null for a plain task. */
export function CategoryIcon({ category, className }: { category?: TaskCategory; className?: string }) {
  const meta = category ? CATEGORY_META[category] : null;
  if (!meta) return null;
  return <meta.Icon className={cn("size-3.5 shrink-0", toneText.emerald, className)} aria-label={categoryLabel(category!)} />;
}
