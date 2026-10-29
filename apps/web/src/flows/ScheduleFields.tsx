// The schedule step's card: quick choices, then fixed times per day, "every N units" or a cron by hand. Whatever the
// owner picks is kept as the step's cron (schedule-form.ts), with its next times in the owner's time zone.
import { Button, Field, IconButton, Icons, Input, SegmentedControl, Select } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { currentLocale, useT } from "../i18n/index.ts";
import { nextWhen } from "./run-view.ts";
import {
  type DayTimes,
  EVERY_START,
  EVERY_STEPS,
  type Every,
  type EveryUnit,
  everyCron,
  dayName as nameOfDay,
  readCron,
  type ScheduleForm,
  timesCron,
  WEEK,
  type Weekday,
} from "./schedule-form.ts";
import { presetOf, SCHEDULE_PRESETS } from "./steps.tsx";

type Mode = ScheduleForm["mode"];
const GROUPS: { label: "flow.sch.weekdays" | "flow.sch.weekend" | "flow.sch.everyDay"; days: Weekday[] }[] = [
  { label: "flow.sch.weekdays", days: [1, 2, 3, 4, 5] },
  { label: "flow.sch.weekend", days: [6, 0] },
  { label: "flow.sch.everyDay", days: [...WEEK] },
];
const UNITS: EveryUnit[] = ["minutes", "hours", "days", "weeks", "months"];
const FIRST_TIME = "09:00";

/** A weekday's name in the panel's language, long or short. */
const dayName = (d: Weekday, width: "long" | "short") => nameOfDay(d, width, currentLocale());

export function ScheduleFields({ cron, onCron }: { cron: string; onCron: (cron: string) => void }) {
  const t = useT();
  const start = readCron(cron);
  const [mode, setMode] = useState<Mode>(start.mode);
  const [days, setDays] = useState<DayTimes>(start.mode === "times" ? start.days : {});
  const [every, setEvery] = useState<Every>(start.mode === "every" ? start.every : EVERY_START);
  const [tooMany, setTooMany] = useState(false);
  const show = (form: ScheduleForm) => {
    setMode(form.mode);
    if (form.mode === "times") setDays(form.days);
    if (form.mode === "every") setEvery(form.every);
    setTooMany(false);
  };
  // The cron this card wrote last: one that comes from elsewhere (undo, an agent) is read again.
  const wrote = useRef(cron);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a cron from elsewhere is read again
  useEffect(() => {
    if (cron === wrote.current) return;
    wrote.current = cron;
    show(readCron(cron));
  }, [cron]);
  const write = (next: string) => {
    wrote.current = next;
    onCron(next);
  };
  const changeDays = (next: DayTimes) => {
    setDays(next);
    const made = timesCron(next);
    setTooMany(made === undefined);
    if (made !== undefined) write(made);
  };
  const changeEvery = (next: Every) => {
    setEvery(next);
    write(everyCron(next));
  };
  const changeMode = (next: string) => {
    const m = next as Mode;
    setMode(m);
    setTooMany(false);
    if (m === "times") {
      const kept = Object.keys(days).length
        ? days
        : { 1: [FIRST_TIME], 2: [FIRST_TIME], 3: [FIRST_TIME], 4: [FIRST_TIME], 5: [FIRST_TIME] };
      changeDays(kept);
    }
    if (m === "every") changeEvery(every);
  };
  const preset = presetOf(cron);
  return (
    <>
      <fieldset className="trg-quick" aria-label={t("flow.f.often")}>
        {SCHEDULE_PRESETS.map((p) => (
          <Button
            key={p.cron}
            size="sm"
            variant={preset?.cron === p.cron ? "primary" : "secondary"}
            aria-pressed={preset?.cron === p.cron}
            onClick={() => {
              write(p.cron);
              show(readCron(p.cron));
            }}
          >
            {t(p.label)}
          </Button>
        ))}
      </fieldset>
      <SegmentedControl
        size="sm"
        label={t("flow.sch.mode")}
        className="trg-modes"
        value={mode}
        onValueChange={changeMode}
        options={[
          { value: "times", label: t("flow.sch.times") },
          { value: "every", label: t("flow.sch.every") },
          { value: "cron", label: t("flow.sch.cron") },
        ]}
      />
      {mode === "times" && <TimesFields days={days} onDays={changeDays} tooMany={tooMany} />}
      {mode === "every" && <EveryFields every={every} onEvery={changeEvery} />}
      {mode === "cron" && (
        <Field label={t("flow.f.cron")} hint={t("flow.sch.cronHint")}>
          {(id) => (
            <Input
              id={id}
              value={cron}
              maxLength={400}
              className="fe-mono"
              spellCheck={false}
              onChange={(e) => write(e.target.value)}
            />
          )}
        </Field>
      )}
      <NextRuns cron={cron} />
    </>
  );
}

/** Days down the card, each with its times; a day without times is off. */
function TimesFields(props: { days: DayTimes; onDays: (days: DayTimes) => void; tooMany: boolean }) {
  const t = useT();
  const { days } = props;
  const firstTimes = () => WEEK.map((d) => days[d]).find((x) => x?.length) ?? [FIRST_TIME];
  const set = (d: Weekday, times: string[] | undefined) => {
    const next = { ...days };
    if (times?.length) next[d] = times;
    else delete next[d];
    props.onDays(next);
  };
  return (
    <div className="trg-days">
      <div className="trg-groups">
        <span className="fe-ins__label">{t("flow.sch.same")}</span>
        {GROUPS.map((g) => (
          <Button
            key={g.label}
            size="sm"
            variant="ghost"
            onClick={() => {
              const times = firstTimes();
              props.onDays(Object.fromEntries(g.days.map((d) => [d, [...times]])));
            }}
          >
            {t(g.label)}
          </Button>
        ))}
      </div>
      {WEEK.map((d) => {
        const times = days[d];
        return (
          <div key={d} className={times ? "trg-day is-on" : "trg-day"}>
            <button
              type="button"
              className="trg-day__name"
              aria-pressed={Boolean(times)}
              aria-label={dayName(d, "long")}
              onClick={() => set(d, times ? undefined : [...firstTimes()])}
            >
              <span className="trg-day__check" aria-hidden="true">
                {times && <Icons.Check size={12} />}
              </span>
              {dayName(d, "short")}
            </button>
            <div className="trg-day__times">
              {times?.map((time, i) => (
                <Input
                  // biome-ignore lint/suspicious/noArrayIndexKey: two equal times stay apart while typed
                  key={i}
                  type="time"
                  size="sm"
                  className="trg-time"
                  aria-label={t("flow.sch.timeOf", { day: dayName(d, "long") })}
                  value={time}
                  onChange={(e) =>
                    e.target.value &&
                    set(
                      d,
                      times.map((x, j) => (j === i ? e.target.value : x)),
                    )
                  }
                  trailing={
                    <IconButton
                      size="sm"
                      label={t("flow.sch.removeTime")}
                      icon={<Icons.X size={12} />}
                      onClick={() =>
                        set(
                          d,
                          times.filter((_, j) => j !== i),
                        )
                      }
                    />
                  }
                />
              ))}
              {times && times.length < 12 && (
                <IconButton
                  size="sm"
                  label={t("flow.sch.addTime", { day: dayName(d, "long") })}
                  icon={<Icons.Plus size={14} />}
                  onClick={() => set(d, [...times, nextHour(times.at(-1))])}
                />
              )}
              {!times && <span className="trg-day__off">{t("flow.sch.off")}</span>}
            </div>
          </div>
        );
      })}
      {props.tooMany && <span className="fe-next__error">{t("flow.sch.tooMany")}</span>}
    </div>
  );
}

const nextHour = (time = "08:00") => {
  const [h = "8", m = "00"] = time.split(":");
  return `${String((Number(h) + 1) % 24).padStart(2, "0")}:${m}`;
};

function EveryFields({ every, onEvery }: { every: Every; onEvery: (e: Every) => void }) {
  const t = useT();
  const steps = EVERY_STEPS[every.unit];
  const atTime = every.unit === "days" || every.unit === "weeks" || every.unit === "months";
  return (
    <div className="trg-every">
      <div className="trg-every__row">
        <span className="fe-ins__label">{t("flow.sch.everyLabel")}</span>
        {steps.length > 1 && (
          <Select
            size="sm"
            label={t("flow.sch.count")}
            value={String(every.n)}
            onValueChange={(v) => v && onEvery({ ...every, n: Number(v) })}
            options={steps.map((n) => ({ value: String(n), label: String(n) }))}
          />
        )}
        <Select
          size="sm"
          label={t("flow.sch.unit")}
          value={every.unit}
          onValueChange={(v) => {
            const unit = v as EveryUnit;
            const n = EVERY_STEPS[unit].includes(every.n) ? every.n : (EVERY_STEPS[unit][0] ?? 1);
            onEvery({ ...every, unit, n });
          }}
          options={UNITS.map((u) => ({ value: u, label: t(`flow.sch.unit.${u}`) }))}
        />
      </div>
      {(every.unit === "weeks" || every.unit === "months" || atTime) && (
        <div className="trg-every__row">
          {every.unit === "weeks" && (
            <>
              <span className="fe-ins__label">{t("flow.sch.on")}</span>
              <Select
                size="sm"
                label={t("flow.sch.weekday")}
                value={String(every.weekday)}
                onValueChange={(v) => v && onEvery({ ...every, weekday: Number(v) as Weekday })}
                options={WEEK.map((d) => ({ value: String(d), label: dayName(d, "long") }))}
              />
            </>
          )}
          {every.unit === "months" && (
            <>
              <span className="fe-ins__label">{t("flow.sch.onDay")}</span>
              <Select
                size="sm"
                label={t("flow.sch.monthDay")}
                value={String(every.day)}
                onValueChange={(v) => v && onEvery({ ...every, day: Number(v) })}
                options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
              />
            </>
          )}
          <span className="fe-ins__label">{t("flow.sch.at")}</span>
          <Input
            type="time"
            size="sm"
            className="trg-time"
            aria-label={t("flow.sch.atTime")}
            value={every.at}
            onChange={(e) => e.target.value && onEvery({ ...every, at: e.target.value })}
          />
        </div>
      )}
      {!(every.unit === "days" && every.n === 1) && <p className="fe-note">{t(`flow.sch.hint.${every.unit}`)}</p>}
    </div>
  );
}

/** The next three times it runs, or why it can't, and the time zone they are in. */
function NextRuns({ cron }: { cron: string }) {
  const t = useT();
  const [next, setNext] = useState<{ next: string[]; time_zone: string; error: "invalid" | "too_often" | null }>();
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void client.call("flows.next_runs", { cron: cron.trim() || "-" }).then(
        (r) => live && setNext(r),
        () => live && setNext(undefined),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [cron]);
  return (
    <>
      <div className="fe-next" aria-live="polite">
        <span className="fe-ins__label">{t("flow.f.nextRuns")}</span>
        {!cron.trim() ? (
          <span className="fe-next__error">{t("flow.sch.none")}</span>
        ) : next?.error ? (
          <span className="fe-next__error">
            {t(next.error === "too_often" ? "flow.f.cronOften" : "flow.f.cronBad")}
          </span>
        ) : (
          next?.next.map((at) => <span key={at}>{nextWhen(at, next.time_zone, t)}</span>)
        )}
      </div>
      {next && <p className="fe-note">{t("flow.f.scheduleNote", { zone: next.time_zone })}</p>}
    </>
  );
}
