import type { Schedule } from "@apx/protocol";
import { Button, Input, SegmentedControl, Select } from "@apx/ui";
import { useState } from "react";
import { aheadLabel } from "../common/format.ts";
import { DAY_KEY, WeekDays } from "../common/pickers/WeekDays.tsx";
import { type MessageKey, type T, useT } from "../i18n/index.ts";
import { weeklyCron, weeklyOf } from "./cron.ts";

const UNITS = [
  { id: "minutes", n: 1 },
  { id: "hours", n: 60 },
  { id: "days", n: 1440 },
  { id: "weeks", n: 10080 },
] as const;
type Unit = (typeof UNITS)[number]["id"];
/** The largest unit the minutes divide into: 120 → 2 hours. */
export function everyParts(minutes: number): { n: number; unit: Unit } {
  const u = [...UNITS].reverse().find((x) => minutes % x.n === 0) ?? UNITS[0];
  return { n: minutes / u.n, unit: u.id };
}

export function scheduleText(s: Schedule, t: T): string {
  switch (s.kind) {
    case "cron": {
      const w = weeklyOf(s.cron);
      if (!w) return `cron ${s.cron}`;
      const key = w.days.join(",");
      const days =
        w.days.length === 7
          ? t("routines.days.every")
          : key === "1,2,3,4,5"
            ? t("routines.days.weekdays")
            : key === "6,0"
              ? t("routines.days.weekends")
              : w.days.map((d) => t(DAY_KEY[d] as MessageKey)).join(", ");
      return t("routines.atTime", { days, time: w.time });
    }
    case "every": {
      const { n, unit } = everyParts(s.minutes);
      // "Every hour", not "every 1 hours".
      if (n === 1) return t("routines.everyOne", { unit: t(`routines.unitOne.${unit}`) });
      return t("routines.everyUnit", { n, unit: t(`routines.unit.${unit}`) });
    }
    case "once":
      return t("routines.onceAt", { when: aheadLabel(s.at) });
    case "manual":
      return t("routines.manual");
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Local date and time of an ISO instant, as the date and time inputs want them. */
const localParts = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "09:00" };
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
};

export function ScheduleEditor({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const t = useT();
  const [advanced, setAdvanced] = useState(() => value.kind === "cron" && !weeklyOf(value.cron));
  const tomorrow9 = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  };
  const kinds: Record<Schedule["kind"], () => Schedule> = {
    cron: () => ({ kind: "cron", cron: "0 9 * * 1-5" }),
    every: () => ({ kind: "every", minutes: 60 }),
    once: () => ({ kind: "once", at: tomorrow9() }),
    manual: () => ({ kind: "manual" }),
  };
  const weekly = value.kind === "cron" ? weeklyOf(value.cron) : undefined;
  return (
    <div className="pform">
      <SegmentedControl
        size="sm"
        label={t("routines.when")}
        value={value.kind}
        onValueChange={(k) => k !== value.kind && onChange(kinds[k as Schedule["kind"]]())}
        options={[
          { value: "cron", label: t("routines.kind.cron") },
          { value: "every", label: t("routines.kind.every") },
          { value: "once", label: t("routines.kind.once") },
          { value: "manual", label: t("routines.kind.manual") },
        ]}
      />
      {value.kind === "cron" && weekly && !advanced && (
        <div className="sched__weekly">
          <WeekDays
            days={weekly.days}
            label={t("routines.daysLabel")}
            onChange={(days) => onChange({ kind: "cron", cron: weeklyCron(days, weekly.time) })}
          />
          <Input
            type="time"
            aria-label={t("routines.time")}
            className="sched__time"
            value={weekly.time}
            onChange={(e) =>
              e.currentTarget.value && onChange({ kind: "cron", cron: weeklyCron(weekly.days, e.currentTarget.value) })
            }
          />
        </div>
      )}
      {value.kind === "cron" && (advanced || !weekly) && (
        <>
          <Input
            aria-label={t("routines.cron")}
            value={value.cron}
            onChange={(e) => onChange({ kind: "cron", cron: e.currentTarget.value })}
          />
          <span className="pform__hint">{t("routines.cronHint")}</span>
        </>
      )}
      {value.kind === "cron" && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (advanced && !weeklyOf(value.cron)) onChange(kinds.cron());
              setAdvanced(!advanced);
            }}
          >
            {advanced ? t("routines.simple") : t("routines.advanced")}
          </Button>
        </div>
      )}
      {value.kind === "every" && <EveryInput minutes={value.minutes} onChange={onChange} />}
      {value.kind === "once" && <OnceInput at={value.at} onChange={onChange} />}
    </div>
  );
}

function EveryInput({ minutes, onChange }: { minutes: number; onChange: (s: Schedule) => void }) {
  const t = useT();
  const { n, unit } = everyParts(minutes);
  const factor = (u: Unit) => UNITS.find((x) => x.id === u)?.n ?? 1;
  return (
    <div className="tgtoken">
      <Input
        type="number"
        min={1}
        aria-label={t("routines.everyN.n")}
        className="sched__n"
        value={String(n)}
        onChange={(e) =>
          onChange({ kind: "every", minutes: Math.max(1, Number(e.currentTarget.value) || 1) * factor(unit) })
        }
      />
      <Select
        label={t("routines.everyN.unit")}
        value={unit}
        onValueChange={(u) => u && onChange({ kind: "every", minutes: n * factor(u as Unit) })}
        options={UNITS.map((u) => ({ value: u.id, label: t(`routines.unitOption.${u.id}`) }))}
      />
      {minutes < 5 && <span className="pform__hint">{t("routines.minutes")}</span>}
    </div>
  );
}

function OnceInput({ at, onChange }: { at: string; onChange: (s: Schedule) => void }) {
  const t = useT();
  const { date, time } = localParts(at);
  const set = (d: string, tm: string) => {
    const when = new Date(`${d}T${tm || "09:00"}`);
    if (!Number.isNaN(when.getTime())) onChange({ kind: "once", at: when.toISOString() });
  };
  return (
    <div className="tgtoken">
      <Input
        type="date"
        aria-label={t("routines.date")}
        value={date}
        onChange={(e) => set(e.currentTarget.value, time)}
      />
      <Input
        type="time"
        aria-label={t("routines.time")}
        value={time}
        onChange={(e) => set(date, e.currentTarget.value)}
      />
    </div>
  );
}
