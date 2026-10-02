import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cx } from "../cx";
import { Popover } from "./Popover";

/** A calendar day as "YYYY-MM-DD" (local, no zone). */
export type DayString = string;

export interface DateLabels {
  placeholder: string;
  clear: string;
  prevMonth: string;
  nextMonth: string;
  time: string;
}

const DEFAULT_LABELS: DateLabels = {
  placeholder: "Pick a date",
  clear: "Clear",
  prevMonth: "Previous month",
  nextMonth: "Next month",
  time: "Time",
};

const pad = (n: number) => String(n).padStart(2, "0");
export const dayString = (d: Date): DayString => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s: string | undefined): Date | undefined => {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
};
const timeOf = (s: string | undefined) => (s ? /T(\d{2}:\d{2})/.exec(s)?.[1] : undefined);

export interface CalendarProps {
  /** Selected day, or the two ends of a range. */
  selected?: DayString | { from?: DayString; to?: DayString } | undefined;
  onPick: (day: DayString) => void;
  /** Days before this one cannot be picked. */
  min?: DayString;
  locale?: string;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn?: 0 | 1;
  labels?: Partial<DateLabels>;
}

/** A month grid. Used by DatePicker and DateRangePicker; usable alone inside a Popover. */
export function Calendar({ selected, onPick, min, locale, weekStartsOn = 1, labels }: CalendarProps) {
  const l = { ...DEFAULT_LABELS, ...labels };
  const range = typeof selected === "object" ? selected : undefined;
  const single = typeof selected === "string" ? selected : undefined;
  const first = parseDay(single ?? range?.from) ?? new Date();
  const [month, setMonth] = useState(() => new Date(first.getFullYear(), first.getMonth(), 1));
  const [hover, setHover] = useState<DayString>();
  const today = dayString(new Date());
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month);
  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    // 2024-01-07 is a Sunday.
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(2024, 0, 7 + ((i + weekStartsOn) % 7))));
  }, [locale, weekStartsOn]);
  const days = useMemo(() => {
    const lead = (month.getDay() - weekStartsOn + 7) % 7;
    return Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - lead + i));
  }, [month, weekStartsOn]);
  // While only the start of a range is set, the hovered day previews its end.
  const end = range?.from && !range.to && hover && hover >= range.from ? hover : range?.to;
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div className="apx-cal">
      <div className="apx-cal__head">
        <button type="button" className="apx-cal__nav" aria-label={l.prevMonth} onClick={() => shift(-1)}>
          <ChevronLeft size={16} />
        </button>
        <span className="apx-cal__title">{title}</span>
        <button type="button" className="apx-cal__nav" aria-label={l.nextMonth} onClick={() => shift(1)}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="apx-cal__grid">
        {weekdays.map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: narrow weekday names repeat (S, S).
          <span key={i} className="apx-cal__weekday" aria-hidden="true">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const s = dayString(d);
          const isSel = s === single || s === range?.from || s === end;
          const inRange = Boolean(range?.from && end && s > range.from && s < end);
          return (
            <button
              key={s}
              type="button"
              className={cx(
                "apx-cal__day",
                d.getMonth() !== month.getMonth() && "is-outside",
                s === today && "is-today",
                isSel && "is-selected",
                inRange && "is-inrange",
              )}
              aria-pressed={isSel}
              disabled={Boolean(min && s < min)}
              onMouseEnter={() => setHover(s)}
              onClick={() => onPick(s)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface DatePickerProps {
  /** "YYYY-MM-DD", or "YYYY-MM-DDTHH:MM" with `withTime`; undefined = no date. */
  value: string | undefined;
  onValueChange: (value: string | undefined) => void;
  /** Adds an optional time under the calendar. */
  withTime?: boolean;
  /** Quick picks above the calendar ("Today", "Tomorrow", "Next Monday"). */
  presets?: { label: string; value: DayString }[];
  min?: DayString;
  locale?: string;
  weekStartsOn?: 0 | 1;
  labels?: Partial<DateLabels>;
  size?: "sm" | "md";
  /** Accessible name of the trigger. */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** A date (and optional time) in a popover calendar: due dates, reminders, filters. */
export function DatePicker({
  value,
  onValueChange,
  withTime,
  presets,
  min,
  locale,
  weekStartsOn,
  labels,
  size = "md",
  label,
  disabled,
  className,
}: DatePickerProps) {
  const l = { ...DEFAULT_LABELS, ...labels };
  const [open, setOpen] = useState(false);
  const day = parseDay(value);
  const time = timeOf(value);
  const set = (d: DayString | undefined, t = time) => onValueChange(d ? (withTime && t ? `${d}T${t}` : d) : undefined);
  const text = day
    ? new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        ...(day.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
      }).format(day) + (time ? ` · ${time}` : "")
    : l.placeholder;

  return (
    <span className={cx("apx-datewrap", className)}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        label={label}
        className="apx-datepop"
        trigger={
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            className={cx(
              "apx-field",
              `apx-field--${size}`,
              "apx-datefield",
              !day && "is-placeholder",
              day && "has-clear",
            )}
          >
            <CalendarDays size={14} className="apx-datefield__icon" />
            <span className="apx-datefield__text">{text}</span>
          </button>
        }
      >
        {presets && presets.length > 0 && (
          <div className="apx-datepop__presets">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className={cx("apx-datepop__preset", value?.startsWith(p.value) && "is-on")}
                onClick={() => {
                  set(p.value);
                  if (!withTime) setOpen(false);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <Calendar
          selected={value ? dayString(day as Date) : undefined}
          onPick={(d) => {
            set(d);
            if (!withTime) setOpen(false);
          }}
          {...(min ? { min } : {})}
          {...(locale ? { locale } : {})}
          {...(weekStartsOn != null ? { weekStartsOn } : {})}
          labels={l}
        />
        {withTime && (
          <label className="apx-datepop__time">
            <span>{l.time}</span>
            <input
              type="time"
              className="apx-field apx-field--sm apx-datepop__timeinput"
              value={time ?? ""}
              disabled={!day}
              onChange={(e) => set(value ? dayString(day as Date) : undefined, e.target.value || undefined)}
            />
          </label>
        )}
      </Popover>
      {day && !disabled && (
        <button
          type="button"
          className="apx-datefield__clear"
          aria-label={l.clear}
          onClick={() => onValueChange(undefined)}
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}

export interface DateRangePickerProps {
  value: { from?: DayString; to?: DayString };
  onValueChange: (value: { from?: DayString; to?: DayString }) => void;
  min?: DayString;
  locale?: string;
  weekStartsOn?: 0 | 1;
  labels?: Partial<DateLabels>;
  size?: "sm" | "md";
  label: string;
  className?: string;
}

/** Two dates in one calendar: the first click sets the start, the second the end. */
export function DateRangePicker({
  value,
  onValueChange,
  min,
  locale,
  weekStartsOn,
  labels,
  size = "md",
  label,
  className,
}: DateRangePickerProps) {
  const l = { ...DEFAULT_LABELS, ...labels };
  const [open, setOpen] = useState(false);
  const f = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const from = parseDay(value.from);
  const to = parseDay(value.to);
  const text = from ? `${f.format(from)} – ${to ? f.format(to) : "…"}` : l.placeholder;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={label}
      className="apx-datepop"
      trigger={
        <button
          type="button"
          aria-label={label}
          className={cx("apx-field", `apx-field--${size}`, "apx-datefield", !from && "is-placeholder", className)}
        >
          <CalendarDays size={14} className="apx-datefield__icon" />
          <span className="apx-datefield__text">{text}</span>
        </button>
      }
    >
      <Calendar
        selected={value}
        onPick={(d) => {
          if (!value.from || value.to || d < value.from) onValueChange({ from: d });
          else {
            onValueChange({ from: value.from, to: d });
            setOpen(false);
          }
        }}
        {...(min ? { min } : {})}
        {...(locale ? { locale } : {})}
        {...(weekStartsOn != null ? { weekStartsOn } : {})}
        labels={l}
      />
      {from && (
        <div className="apx-datepop__presets">
          <button type="button" className="apx-datepop__preset" onClick={() => onValueChange({})}>
            {l.clear}
          </button>
        </div>
      )}
    </Popover>
  );
}
