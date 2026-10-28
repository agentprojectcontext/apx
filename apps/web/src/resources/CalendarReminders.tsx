import type { CalendarReminders as Reminders } from "@apx/protocol";
import { CALENDAR_LEAD } from "@apx/protocol/client";
import { Input, Select, SettingRow, Skeleton, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

const UNITS = { min: 1, h: 60, d: 1440 } as const;
type Unit = keyof typeof UNITS;
/** 90 → 90 minutes, 120 → 2 hours, 1440 → 1 day: the largest unit it fits in whole. */
const split = (min: number): { n: number; unit: Unit } =>
  min % UNITS.d === 0
    ? { n: min / UNITS.d, unit: "d" }
    : min % UNITS.h === 0
      ? { n: min / UNITS.h, unit: "h" }
      : { n: min, unit: "min" };
const clamp = (min: number) => Math.max(CALENDAR_LEAD.min, Math.min(CALENDAR_LEAD.max, Math.round(min)));

/** Google Calendar's settings: whether the owner hears of an event before it starts, and how long before. */
export function CalendarReminders({ id }: { id: string }) {
  const t = useT();
  const [saved, setSaved] = useState<Reminders>();
  useEffect(() => {
    client
      .call("integrations.settings", { id })
      .then((r) => setSaved(r.reminders))
      .catch((e: unknown) => notify(t("error.load", { error: e instanceof Error ? e.message : String(e) })));
  }, [id, t]);
  if (!saved) return <Skeleton height={96} />;
  const save = async (change: Partial<Reminders>) => {
    try {
      setSaved((await client.call("integrations.configure", { id, reminders: change })).reminders);
    } catch (e) {
      notify(t("error.change", { error: e instanceof Error ? e.message : String(e) }));
    }
  };
  return (
    <>
      <SettingRow title={t("int.cal.remind")} description={t("int.cal.remindHint")}>
        <Switch
          aria-label={t("int.cal.remind")}
          checked={saved.enabled}
          onCheckedChange={(enabled) => void save({ enabled })}
        />
      </SettingRow>
      <SettingRow title={t("int.cal.lead")} description={t("int.cal.leadHint")}>
        <Lead
          key={saved.lead_min}
          minutes={saved.lead_min}
          disabled={!saved.enabled}
          onSave={(lead_min) => void save({ lead_min })}
        />
      </SettingRow>
    </>
  );
}

/** A number and its unit; saved when both are left or the unit changes (a value it already had is not sent). */
function Lead({ minutes, disabled, onSave }: { minutes: number; disabled: boolean; onSave(min: number): void }) {
  const t = useT();
  const start = split(minutes);
  const [draft, setDraft] = useState(String(start.n));
  const [unit, setUnit] = useState(start.unit);
  const commit = (u: Unit) => {
    const n = Number(draft);
    const min = clamp((Number.isFinite(n) && n > 0 ? n : 1) * UNITS[u]);
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
        aria-label={t("int.cal.lead")}
        type="number"
        min={1}
        className="nudge__num"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <Select
        label={t("int.cal.unit")}
        disabled={disabled}
        value={unit}
        onValueChange={(v) => v && commit(v as Unit)}
        options={(Object.keys(UNITS) as Unit[]).map((u) => ({ value: u, label: t(`int.cal.unit.${u}`) }))}
      />
    </fieldset>
  );
}
