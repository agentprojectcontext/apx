import { Input, Select } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";

const UNITS = { min: 1, h: 60, d: 1440 } as const;
export type Unit = keyof typeof UNITS;
/** 90 → 90 minutes, 120 → 2 hours, 1440 → 1 day: the largest of `units` it fits in whole. */
const split = (min: number, units: readonly Unit[]): { n: number; unit: Unit } => {
  const unit = [...units].reverse().find((u) => min % UNITS[u] === 0) ?? "min";
  return { n: min / UNITS[unit], unit };
};

/**
 * A number of minutes as a number and its unit; saved when both are left or the unit changes (a value it already had
 * is not sent). Keyed by the caller on `minutes`, so a saved value starts it again.
 */
export function Duration({
  label,
  minutes,
  range,
  units = ["min", "h", "d"],
  disabled,
  onSave,
}: {
  label: string;
  minutes: number;
  range: { min: number; max: number };
  units?: readonly Unit[];
  disabled: boolean;
  onSave(min: number): void;
}) {
  const t = useT();
  const start = split(minutes, units);
  const [draft, setDraft] = useState(String(start.n));
  const [unit, setUnit] = useState(start.unit);
  const commit = (u: Unit) => {
    const n = Number(draft);
    const min = Math.max(range.min, Math.min(range.max, Math.round((Number.isFinite(n) && n > 0 ? n : 1) * UNITS[u])));
    if (min !== minutes) {
      setUnit(u);
      onSave(min);
    } else {
      setUnit(start.unit);
      setDraft(String(start.n));
    }
  };
  return (
    <fieldset
      className="int__lead"
      onBlur={(e) => {
        // Moving to the unit (or its list) is still choosing; leaving both saves what was typed.
        const to = e.relatedTarget;
        if (!(to instanceof Element && (e.currentTarget.contains(to) || to.closest('[role="listbox"]')))) commit(unit);
      }}
    >
      <Input
        aria-label={label}
        type="number"
        min={1}
        className="nudge__num"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <Select
        label={t("int.cal.unitOf", { what: label })}
        disabled={disabled}
        value={unit}
        onValueChange={(v) => v && commit(v as Unit)}
        options={units.map((u) => ({ value: u, label: t(`int.cal.unit.${u}`) }))}
      />
    </fieldset>
  );
}
