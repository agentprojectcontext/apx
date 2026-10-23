import { WEEK } from "../common/week.ts";

/** "30 8 * * 1-5" → days and a time; undefined for a cron that says more (a day of the month, every N minutes). */
export function weeklyOf(cron: string): { days: number[]; time: string } | undefined {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* ([\d,*-]+)$/.exec(cron.trim());
  if (!m) return undefined;
  const days = new Set<number>();
  for (const part of (m[3] ?? "").split(",")) {
    if (part === "*") for (const d of WEEK) days.add(d);
    else if (/^\d-\d$/.test(part)) {
      const [a = 0, b = 0] = part.split("-").map(Number);
      for (let d = a; d <= b; d++) days.add(d % 7);
    } else if (/^\d$/.test(part)) days.add(Number(part) % 7);
    else return undefined;
  }
  return { days: WEEK.filter((d) => days.has(d)), time: `${m[2]?.padStart(2, "0")}:${m[1]?.padStart(2, "0")}` };
}

export function weeklyCron(days: number[], time: string): string {
  const [h = "9", min = "0"] = time.split(":");
  const all = days.length === 7;
  const list = [...days].sort((a, b) => a - b).join(",");
  return `${Number(min)} ${Number(h)} * * ${all ? "*" : list === "1,2,3,4,5" ? "1-5" : list || "*"}`;
}
