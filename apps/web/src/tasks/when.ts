// Due dates and reminders between the core (ISO moments) and the pickers (local "YYYY-MM-DD[THH:MM]").

/** A bare day is 09:00 that day in the core; the picker shows it as a day. */
const BARE_HOUR = 9;
const pad = (n: number) => String(n).padStart(2, "0");

/** The picker value of a moment: a day when it is 09:00, else day and time. */
export function pickerValue(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return d.getHours() === BARE_HOUR && d.getMinutes() === 0
    ? day
    : `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The moment a picker value stands for (a bare day is 09:00). */
export function momentOf(value: string): Date {
  const [day, time] = value.split("T");
  const [y, m, d] = (day ?? "").split("-").map(Number);
  const [h, min] = time ? time.split(":").map(Number) : [BARE_HOUR, 0];
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, h ?? BARE_HOUR, min ?? 0);
}

const local = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const REMINDERS = ["due", "hour", "day", "custom"] as const;
export type Reminder = (typeof REMINDERS)[number];
const OFFSET: Record<"hour" | "day", number> = { hour: 3_600_000, day: 86_400_000 };

/** Which choice a saved reminder is, given the due date: none means "when it is due". */
export function reminderOf(due: string | undefined, remind: string | undefined): Reminder {
  if (!remind) return due ? "due" : "custom";
  if (!due) return "custom";
  const gap = momentOf(due).getTime() - momentOf(remind).getTime();
  return gap === OFFSET.hour ? "hour" : gap === OFFSET.day ? "day" : gap === 0 ? "due" : "custom";
}

/** The reminder to save for a choice: undefined (remind when due), a moment before the due date, or the custom one. */
export function remindAt(due: string | undefined, choice: Reminder, custom: string | undefined): string | undefined {
  if (choice === "custom") return custom;
  if (choice === "due" || !due) return undefined;
  return local(new Date(momentOf(due).getTime() - OFFSET[choice]));
}

/** Quick due dates: today, tomorrow, next Monday (local days). */
export function duePresets(now = new Date()): { key: "today" | "tomorrow" | "monday"; value: string }[] {
  const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const at = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { key: "today", value: day(at(0)) },
    { key: "tomorrow", value: day(at(1)) },
    { key: "monday", value: day(at(toMonday)) },
  ];
}
