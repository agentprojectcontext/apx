import { useEffect, useMemo, useState } from "react";
import { Clock, Code2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import {
  DAY_KEYS, cronToSelection, selectionToCron, describeCron, isPickerFriendly,
  normalizeCron, type CronSelection,
} from "../../lib/cron";

/**
 * Read-only sentence for a cron expression. Falls back to the raw expression
 * when the schedule is beyond what lib/cron understands — a confident wrong
 * reading of when something runs is worse than showing the source.
 */
export function CronSummary({ expr, className }: { expr: string; className?: string }) {
  const text = describeCron(expr, t as never);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={expr}>
      <Clock size={12} className="shrink-0 opacity-60" />
      {text ? <span>{text}</span> : <code className="font-mono text-[11px]">{expr}</code>}
    </span>
  );
}

/**
 * Time + day checkboxes, or every-N-hours, with the cron expression as an
 * escape hatch rather than the only interface.
 *
 * The raw field stays reachable on purpose: cron can express things this
 * picker cannot, and a form that silently narrows what the user is allowed to
 * schedule is worse than one that asks them to type. When the current value is
 * beyond the picker, the raw field opens by itself — the alternative is a
 * picker quietly showing something the expression does not say.
 */
export function CronPicker({
  value,
  onChange,
  disabled,
  allowEveryHours = true,
}: {
  value: string;
  onChange: (expr: string) => void;
  disabled?: boolean;
  allowEveryHours?: boolean;
}) {
  const friendly = useMemo(() => isPickerFriendly(value), [value]);
  const [raw, setRaw] = useState(!friendly);
  const [rawDraft, setRawDraft] = useState(value);
  const sel = useMemo<CronSelection>(() => cronToSelection(value), [value]);

  // An expression arriving from outside (a profile default, another edit) that
  // the picker cannot represent flips to raw rather than misrepresenting it.
  useEffect(() => {
    setRawDraft(value);
    if (!isPickerFriendly(value)) setRaw(true);
  }, [value]);

  const patch = (over: Partial<CronSelection>) =>
    onChange(selectionToCron({ ...sel, ...over }));

  const toggleDay = (d: number) => {
    const next = sel.days.includes(d) ? sel.days.filter((x) => x !== d) : [...sel.days, d];
    patch({ days: next });
  };

  const preset = (days: number[]) => patch({ days });

  return (
    <div className="flex flex-col gap-2" data-testid="cron-picker">
      {raw ? (
        <input
          value={rawDraft}
          disabled={disabled}
          onChange={(e) => setRawDraft(e.target.value)}
          onBlur={() => onChange(rawDraft.trim())}
          onKeyDown={(e) => { if (e.key === "Enter") onChange(rawDraft.trim()); }}
          placeholder="30 8 * * 1-5"
          className="w-full rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 font-mono text-sm outline-none focus:border-primary/60"
          data-testid="cron-raw"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="time"
              value={sel.everyHours > 0 ? "00:00" : sel.time}
              disabled={disabled || sel.everyHours > 0}
              onChange={(e) => patch({ time: e.target.value, everyHours: 0 })}
              className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 disabled:opacity-50"
              data-testid="cron-time"
            />
            {allowEveryHours ? (
              <label className="flex items-center gap-1.5 text-xs text-muted-fg">
                <input
                  type="checkbox"
                  checked={sel.everyHours > 0}
                  disabled={disabled}
                  onChange={(e) => patch({ everyHours: e.target.checked ? 2 : 0 })}
                  className="size-3.5 accent-[var(--primary)]"
                />
                {t("cron.every_label")}
              </label>
            ) : null}
            {sel.everyHours > 0 ? (
              <input
                type="number"
                min={1}
                max={23}
                value={sel.everyHours}
                disabled={disabled}
                onChange={(e) => patch({ everyHours: Number(e.target.value) })}
                className="w-16 rounded-lg border border-border bg-muted/30 px-2 py-1.5 text-sm outline-none focus:border-primary/60"
                aria-label={t("cron.every_label")}
              />
            ) : null}
          </div>

          {sel.everyHours === 0 ? (
            <>
              <div className="flex flex-wrap gap-1" data-testid="cron-days">
                {DAY_KEYS.map((key, d) => {
                  const on = sel.days.length === 0 || sel.days.includes(d);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={disabled}
                      aria-pressed={sel.days.includes(d)}
                      onClick={() => toggleDay(d)}
                      className={cn(
                        "min-w-9 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                        sel.days.includes(d)
                          ? "border-primary bg-primary/15 text-foreground"
                          : on
                            // "every day" means all seven are in effect even
                            // though none is individually ticked — show that
                            // rather than seven blank boxes.
                            ? "border-border bg-muted/40 text-muted-fg"
                            : "border-border text-muted-fg hover:bg-muted/40",
                      )}
                    >
                      {t(`cron.day_short.${key}`)}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1 text-[11px]">
                {([
                  ["cron.preset_every_day", [] as number[]],
                  ["cron.preset_weekdays", [1, 2, 3, 4, 5]],
                  ["cron.preset_weekends", [0, 6]],
                ] as const).map(([label, days]) => (
                  <button
                    key={label}
                    type="button"
                    disabled={disabled}
                    onClick={() => preset([...days])}
                    className="rounded-md px-1.5 py-0.5 text-muted-fg underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}

      <div className="flex items-center justify-between gap-2">
        {/* The sentence, always — including in raw mode, where it is the only
            confirmation that what was typed means what was intended. */}
        <CronSummary expr={raw ? rawDraft : value} className="text-[11px] text-muted-fg" />
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (raw) {
              // Leaving raw mode must not silently rewrite a schedule the
              // picker cannot hold.
              const next = rawDraft.trim();
              onChange(next);
              if (isPickerFriendly(next)) setRaw(false);
            } else {
              setRawDraft(normalizeCron(value));
              setRaw(true);
            }
          }}
          className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-fg hover:text-foreground"
          data-testid="cron-toggle-raw"
        >
          <Code2 size={11} /> {raw ? t("cron.use_picker") : t("cron.use_cron")}
        </button>
      </div>
    </div>
  );
}
