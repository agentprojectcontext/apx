// What a task's properties can be on the phone: the board's columns, priorities, kinds and who may do it.

import type { Agent, Task } from "../hooks/useWorkspace";
import type { Key } from "../i18n/index.ts";
import { pickerValue } from "./when.ts";

export type TaskColumn = { id: string; label: string };
export type TaskPriority = "urgent" | "high" | "normal" | "low";
export type TaskKind = Task["kind"];

/** The core's default board, until tasks.list says which columns the owner keeps. */
export const DEFAULT_COLUMNS: TaskColumn[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "review", label: "Review" },
];
const COLUMN_KEY: Record<string, Key> = {
  backlog: "tkColBacklog",
  todo: "tkColTodo",
  doing: "tkColDoing",
  review: "tkColReview",
};
export const PRIORITIES: readonly TaskPriority[] = ["urgent", "high", "normal", "low"];
export const PRIORITY_KEY: Record<TaskPriority, Key> = {
  urgent: "tkPrioUrgent",
  high: "tkPrioHigh",
  normal: "tkPrioNormal",
  low: "tkPrioLow",
};
export const KINDS: readonly TaskKind[] = ["task", "commitment", "errand"];
export const KIND_KEY: Record<TaskKind, Key> = {
  task: "tkTypeTask",
  commitment: "tkTypeCommitment",
  errand: "tkTypeErrand",
};

/** A default column in the owner's language; a column the owner made keeps its own name. */
export function columnName(column: TaskColumn, t: (key: Key) => string): string {
  const key = COLUMN_KEY[column.id];
  return key ? t(key) : column.label;
}

/** Who may take a task: a project's team and the super-agent, or every agent outside projects for a global one. */
export function assignableAgents(agents: readonly Agent[], projectId?: string): Agent[] {
  return agents
    .filter((agent) => (agent.project_id ? agent.project_id === projectId : !projectId || agent.kind === "secretary"))
    .sort(
      (a, b) =>
        Number(b.kind === "secretary") - Number(a.kind === "secretary") ||
        Number(Boolean(a.project_id)) - Number(Boolean(b.project_id)) ||
        a.name.localeCompare(b.name),
    );
}

/** What the owner changes on a task, as tasks.update takes it (`null` clears). */
export type TaskPatch = {
  title?: string;
  description?: string;
  status?: string;
  kind?: TaskKind;
  priority?: TaskPriority;
  project?: string | null;
  assignee?: string | null;
  due_at?: string | null;
  awaits_owner?: boolean;
};

/** The properties the rows show and change; `due` is a picker value ("2026-10-05" or "2026-10-05T18:00"). */
export type TaskValues = {
  status: string;
  kind: TaskKind;
  priority: TaskPriority;
  project?: string;
  assignee?: string;
  due?: string;
};

/** A stored task's values as the rows read them. */
export function taskValues(task: {
  status: string;
  kind: TaskKind;
  priority: string;
  project_id?: string;
  assignee?: string;
  due_at?: string;
}): TaskValues {
  return {
    status: task.status,
    kind: task.kind,
    priority: (PRIORITIES as readonly string[]).includes(task.priority) ? (task.priority as TaskPriority) : "normal",
    project: task.project_id,
    assignee: task.assignee,
    due: pickerValue(task.due_at),
  };
}

/** The values after a change, as a new task's form keeps them (`null` clears). */
export function applyPatch(values: TaskValues, patch: TaskPatch): TaskValues {
  const pick = <T>(next: T | null | undefined, now: T | undefined) => (next === undefined ? now : (next ?? undefined));
  return {
    status: patch.status ?? values.status,
    kind: patch.kind ?? values.kind,
    priority: patch.priority ?? values.priority,
    project: pick(patch.project, values.project),
    assignee: pick(patch.assignee, values.assignee),
    due: patch.due_at === undefined ? values.due : pickerValue(patch.due_at ?? undefined),
  };
}
