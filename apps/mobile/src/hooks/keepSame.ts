/**
 * The workspace as it was where a reload brought the same values back: the screens re-render only for what changed,
 * which keeps the phone responsive while an agent works and the core reports every step.
 */
export function keepSame<T extends object>(before: T, after: T): T {
  let changed = false;
  const out = { ...after };
  for (const key of Object.keys(after) as Array<keyof T>) {
    if (before[key] === after[key] || JSON.stringify(before[key]) === JSON.stringify(after[key]))
      out[key] = before[key];
    else changed = true;
  }
  return changed || Object.keys(before).length !== Object.keys(after).length ? out : before;
}

/** Core events that change what the lists show; streamed text, terminals and screens do not. */
export const RELOADS: ReadonlySet<string> = new Set([
  "thread.updated",
  "thread.deleted",
  "message.created",
  "run.updated",
  "job.updated",
  "task.updated",
  "task.deleted",
  "notification.updated",
  "team.updated",
]);
