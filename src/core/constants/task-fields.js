import { OWNER_ACTOR_ID } from "./actors.js";

export const TASK_PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);
export const DEFAULT_TASK_PRIORITY = "normal";

export const TASK_REMINDER_FREQUENCIES = Object.freeze(["none", "once", "daily", "weekly"]);
export const DEFAULT_TASK_REMINDER_FREQUENCY = "none";

/** `human` is accepted at every write boundary; storage stays canonical. */
export function normalizeTaskAssignee(value) {
  const assignee = typeof value === "string" ? value.trim() : "";
  if (!assignee) return null;
  return ["human", OWNER_ACTOR_ID].includes(assignee.toLowerCase())
    ? OWNER_ACTOR_ID
    : assignee;
}

export function normalizeTaskPriority(value) {
  const priority = String(value || "").trim().toLowerCase();
  return TASK_PRIORITIES.includes(priority) ? priority : DEFAULT_TASK_PRIORITY;
}

export function normalizeTaskReminderFrequency(value) {
  const frequency = String(value || "").trim().toLowerCase();
  return TASK_REMINDER_FREQUENCIES.includes(frequency)
    ? frequency
    : DEFAULT_TASK_REMINDER_FREQUENCY;
}
