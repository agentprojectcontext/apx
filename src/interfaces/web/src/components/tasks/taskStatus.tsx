import { Circle, CheckCircle2, XCircle, Car } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneDot, toneText, toneTint } from "../../lib/tone";
import type { TaskCategory, TaskEntry, TaskStatus } from "../../types/daemon";

/**
 * How a task looks. Three rules, and they exist because the old version broke
 * all three:
 *
 * 1. A TASK IS A TASK. One glyph per STATE — open, done, dropped — never one
 *    per status. It used to draw a different icon for every status, so the same
 *    row changed shape as it moved and nothing on screen said "this is a task".
 *
 * 2. NOTHING SPINS. `running` had an animated spinner, which meant a card
 *    parked in that column looked like it was loading forever. A column is
 *    where a task IS, not something happening right now.
 *
 * 3. ANY STATUS RENDERS. Columns are configurable now, so `status` can be any
 *    slug. Every helper here used to index a four-entry table directly, so the
 *    first custom column crashed the list, the board and the phone. Unknown
 *    ids get a stable colour derived from the id and a label made from it.
 *
 * Status is carried by COLOUR and a LABEL, never by the glyph.
 */

type Tone = "amber" | "sky" | "violet" | "slate" | "teal" | "rose" | "indigo" | "orange" | "cyan" | "lime";

/** The shipped columns keep the tones they were designed with. */
const BUILTIN_TONES: Record<string, Tone> = {
  pending: "amber",
  running: "sky",
  in_review: "violet",
  blocked: "slate",
};

/** Anything configured later picks from these, stably by id. */
const CUSTOM_TONES: Tone[] = ["teal", "rose", "indigo", "orange", "cyan", "lime"];

export const TASK_STATUS_ORDER: TaskStatus[] = ["pending", "running", "in_review", "blocked"];

/** Same id, same colour, every time and on every surface. */
function toneFor(status: string): Tone {
  const builtin = BUILTIN_TONES[status];
  if (builtin) return builtin;
  let hash = 0;
  for (let i = 0; i < status.length; i++) hash = (hash * 31 + status.charCodeAt(i)) >>> 0;
  return CUSTOM_TONES[hash % CUSTOM_TONES.length];
}

/**
 * Effective status for display: closed tasks render as done/dropped regardless
 * of the open sub-status they were last in.
 */
export function effectiveStatus(task: TaskEntry): TaskStatus | "done" | "dropped" {
  if (task.state === "done") return "done";
  if (task.state === "dropped") return "dropped";
  return (task.status ?? "pending") as TaskStatus;
}

/**
 * A readable name for any status. Built-ins are translated; a configured column
 * falls back to its own id made presentable ("waiting-on-client" → "Waiting on
 * client") rather than printing the raw i18n key.
 */
export function statusLabel(status: string): string {
  if (status === "done") return t("tasks.done_label");
  if (status === "dropped") return t("tasks.dropped_label");
  const key = `tasks.status_${status}`;
  const label = t(key as never);
  if (label !== key) return label;
  const words = status.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Background+foreground for the little square that carries the glyph in lists. */
export function statusTint(status: string): string {
  if (status === "done") return toneTint.emerald;
  if (status === "dropped") return "bg-muted text-muted-foreground";
  return toneTint[toneFor(status)];
}

/** Text colour for a status, wherever it is written rather than filled. */
export function statusText(status: string): string {
  if (status === "done") return toneText.emerald;
  if (status === "dropped") return "text-muted-foreground";
  return toneText[toneFor(status)];
}

/**
 * The glyph. THREE of them, by state — not one per status.
 *
 * `Circle` for anything open reads as an empty checkbox, which is exactly what
 * it is wherever it is clickable.
 */
export function StatusIcon({ status, className }: { status: string; className?: string }) {
  if (status === "done") return <CheckCircle2 className={cn("size-4", toneText.emerald, className)} />;
  if (status === "dropped") return <XCircle className={cn("size-4 text-muted-foreground", className)} />;
  return <Circle className={cn("size-4", statusText(status), className)} />;
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        statusText(status),
        status === "dropped" ? "border-border" : "border-current/30",
      )}
    >
      <StatusIcon status={status} className="size-3" />
      {statusLabel(status)}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  if (status === "done") return <span className={cn("size-2 rounded-full", toneDot.emerald)} />;
  if (status === "dropped") return <span className="size-2 rounded-full bg-muted-foreground" />;
  return <span className={cn("size-2 rounded-full", toneDot[toneFor(status)])} />;
}

/**
 * The status, written along the bottom edge of a card or row.
 *
 * On a board the column already says where a card is — until you look at the
 * same task in the list, where nothing did. This is the one element that reads
 * the same in both views, which is the point: the colour bar identifies the
 * status at a glance and the word removes any doubt.
 */
export function StatusFooter({ status, className }: { status: string; className?: string }) {
  return (
    <div
      data-testid={`status-footer-${status}`}
      className={cn("flex items-center gap-1.5 text-[10px] font-medium", statusText(status), className)}
    >
      <StatusDot status={status} />
      {statusLabel(status)}
    </div>
  );
}

// ── Category ────────────────────────────────────────────────────────────────
// What KIND of task, next to the state glyph that says how it is going. The
// two answer different questions and both belong on the row: a trip errand is
// a trip errand whether it is pending or blocked.
interface CategoryMeta {
  labelKey: string;
  /** Null draws nothing — an icon on every row carries no information. */
  Icon: typeof Car | null;
  /** Can it carry a place? That is what makes the mobility geofence consider it. */
  locatable: boolean;
}

// Mirrors core/constants/task-categories.js. Adding one there means adding it
// here too — the registry is small and closed on purpose, and the panel has no
// path into src/core.
const CATEGORY_META: Record<TaskCategory, CategoryMeta> = {
  general: { labelKey: "tasks.category_general", Icon: null, locatable: false },
  trip: { labelKey: "tasks.category_trip", Icon: Car, locatable: true },
};

/** The order the picker offers them in — the plain one first. */
export const TASK_CATEGORY_ORDER: TaskCategory[] = ["general", "trip"];

/** Does this kind of task get the place fields? */
export function categoryIsLocatable(category?: TaskCategory | null): boolean {
  return CATEGORY_META[(category || "general") as TaskCategory]?.locatable === true;
}

export function categoryLabel(category: TaskCategory): string {
  const meta = CATEGORY_META[category];
  return t((meta?.labelKey ?? "tasks.category_general") as never);
}

/** The little mark that says this is an errand. Null for a plain task. */
export function CategoryIcon({ category, className }: { category?: TaskCategory; className?: string }) {
  const Icon = category ? CATEGORY_META[category]?.Icon : null;
  if (!Icon) return null;
  return <Icon className={cn("size-3.5 shrink-0", toneText.emerald, className)} aria-label={categoryLabel(category!)} />;
}
