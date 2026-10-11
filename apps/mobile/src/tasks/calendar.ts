// The month a date sheet shows: weeks from Monday, with blanks before the 1st and after the last day.

/** Each week of the month as seven cells: the day of the month, or null outside it. */
export function monthWeeks(year: number, month: number): Array<Array<number | null>> {
  const first = new Date(year, month, 1).getDay();
  const lead = (first + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A local day as the pickers write it ("2026-10-05"). */
export function dayValue(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** The picker value with another time: a bare day (`time` undefined) or that day at "HH:MM". */
export function withTime(day: string, time: string | undefined): string {
  return time ? `${day}T${time}` : day;
}

/** "HH:MM" on the 24-hour clock, or undefined when it does not read as one. */
export function clockValue(text: string): string | undefined {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(text.trim());
  if (!m) return undefined;
  const [h, min] = [Number(m[1]), Number(m[2])];
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : undefined;
}
