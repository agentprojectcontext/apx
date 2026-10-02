import type { Schedule } from "@apx/protocol";
import { Button, Icons, Input, Menu, SegmentedControl } from "@apx/ui";
import { aheadLabel } from "../common/format.ts";
import { type T, useT } from "../i18n/index.ts";

/** Ready-made times; any other five-field cron can be typed. */
const PRESETS = [
  { cron: "0 9 * * *", key: "routines.preset.daily" },
  { cron: "30 8 * * 1-5", key: "routines.preset.weekdays" },
  { cron: "0 9 * * 1", key: "routines.preset.mondays" },
  { cron: "0 * * * *", key: "routines.preset.hourly" },
] as const;

export function scheduleText(s: Schedule, t: T): string {
  switch (s.kind) {
    case "cron": {
      const preset = PRESETS.find((p) => p.cron === s.cron);
      return preset ? t(preset.key) : `cron ${s.cron}`;
    }
    case "every":
      return t("routines.everyN", { n: s.minutes });
    case "once":
      return t("routines.onceAt", { when: aheadLabel(s.at) });
    case "manual":
      return t("routines.manual");
  }
}

/** `datetime-local` wants local time without a zone. */
const localInput = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function ScheduleEditor({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const t = useT();
  const tomorrow9 = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  };
  const kinds: Record<Schedule["kind"], () => Schedule> = {
    cron: () => ({ kind: "cron", cron: "0 9 * * *" }),
    every: () => ({ kind: "every", minutes: 60 }),
    once: () => ({ kind: "once", at: tomorrow9() }),
    manual: () => ({ kind: "manual" }),
  };
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
      {value.kind === "cron" && (
        <div className="tgtoken">
          <Menu
            trigger={
              <Button variant="secondary" size="sm" trailingIcon={<Icons.ChevronDown size={14} />}>
                {scheduleText(value, t)}
              </Button>
            }
            items={PRESETS.map((p) => ({ label: t(p.key), onSelect: () => onChange({ kind: "cron", cron: p.cron }) }))}
          />
          <Input
            aria-label={t("routines.cron")}
            value={value.cron}
            onChange={(e) => onChange({ kind: "cron", cron: e.currentTarget.value })}
          />
        </div>
      )}
      {value.kind === "cron" && <span className="pform__hint">{t("routines.cronHint")}</span>}
      {value.kind === "every" && (
        <div className="tgtoken">
          <Input
            type="number"
            min={5}
            aria-label={t("routines.minutes")}
            value={String(value.minutes)}
            onChange={(e) => onChange({ kind: "every", minutes: Number(e.currentTarget.value) || 0 })}
          />
          <span className="pform__hint">{t("routines.minutes")}</span>
        </div>
      )}
      {value.kind === "once" && (
        <Input
          type="datetime-local"
          aria-label={t("routines.kind.once")}
          value={localInput(value.at)}
          onChange={(e) => {
            const d = new Date(e.currentTarget.value);
            if (!Number.isNaN(d.getTime())) onChange({ kind: "once", at: d.toISOString() });
          }}
        />
      )}
    </div>
  );
}
