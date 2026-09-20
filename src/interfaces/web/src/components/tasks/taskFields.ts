import { t } from "../../i18n";
import type { UiSelectOption } from "../UiSelect";
import type { TaskEntry } from "../../types/daemon";

/**
 * The three small pickers a task carries — who has it, how much it presses,
 * whether it nags — in ONE place.
 *
 * They used to be spelled out at each call site, which is how the panel ended
 * up offering "human" for a field that storage always writes as "owner": the
 * select found no option with that value, fell through to printing the raw
 * one, and the field for "who has this" read `owner` at the person who has it.
 * Three surfaces now (the panel's detail, the task form, the phone's sheet),
 * so a fourth spelling is a bug waiting rather than a hypothetical.
 */

/**
 * What storage actually writes for "the human has it".
 *
 * `human` is ACCEPTED at every write boundary and normalized to this
 * (core/constants/task-fields.js → normalizeTaskAssignee), so the option must
 * carry the canonical value or nothing will ever look selected.
 */
export const OWNER_ASSIGNEE = "owner";

/** An agent as the roster endpoint returns it — only the parts a picker needs. */
export type RosterAgent = { slug: string; name?: string | null };

/** Is this task on the person rather than on an agent? */
export function isOwnerAssignee(value?: string | null): boolean {
  const v = String(value || "").trim().toLowerCase();
  return v === OWNER_ASSIGNEE || v === "human";
}

/** "Who has it", including the unassigned option. */
export function assigneeOptions(agents?: RosterAgent[] | null): UiSelectOption[] {
  return [
    { value: "", label: t("tasks.agent_none") },
    { value: OWNER_ASSIGNEE, label: t("tasks.assignee_owner") },
    ...(agents ?? []).map((a) => ({ value: a.slug, label: a.name || a.slug })),
  ];
}

/** The same vocabulary for somewhere that only prints it (a read-only field). */
export function assigneeLabel(value?: string | null, agents?: RosterAgent[] | null): string {
  if (!value) return t("tasks.agent_none_short");
  if (isOwnerAssignee(value)) return t("tasks.assignee_owner");
  const hit = (agents ?? []).find((a) => a.slug === value);
  return hit?.name || hit?.slug || value;
}

export function priorityOptions(): UiSelectOption[] {
  return [
    { value: "low", label: t("tasks.priority_low") },
    { value: "normal", label: t("tasks.priority_normal") },
    { value: "high", label: t("tasks.priority_high") },
    { value: "urgent", label: t("tasks.priority_urgent") },
  ];
}

export function priorityLabel(value?: TaskEntry["priority"] | null): string {
  return priorityOptions().find((o) => o.value === (value || "normal"))?.label ?? String(value);
}

export function reminderOptions(): UiSelectOption[] {
  return [
    { value: "none", label: t("tasks.reminder_none") },
    { value: "once", label: t("tasks.reminder_once") },
    { value: "daily", label: t("tasks.reminder_daily") },
    { value: "weekly", label: t("tasks.reminder_weekly") },
  ];
}
