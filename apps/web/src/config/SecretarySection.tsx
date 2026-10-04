import type { Routine, SecretaryProfile } from "@apx/protocol";
import { Button, Icons, Input, SegmentedControl, Select, SettingRow, Switch } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { SectionHead, SubHead } from "./SectionHead.tsx";

type Days = "1-5" | "*" | "0,6";
const DAYS: Days[] = ["1-5", "*", "0,6"];

/** "30 8 * * 1-5" → 08:30 on weekdays; a cron of another shape is kept as it is. */
function parseCron(cron: string): { time: string; days: Days } | undefined {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|0,6)$/.exec(cron.trim());
  if (!m) return undefined;
  return { time: `${m[2]?.padStart(2, "0")}:${m[1]?.padStart(2, "0")}`, days: m[3] as Days };
}
const toCron = (time: string, days: Days) => {
  const [h = "0", min = "0"] = time.split(":");
  return `${Number(min)} ${Number(h)} * * ${days}`;
};

/**
 * The secretary profile: the super-agent opens and closes your day (always arrives), watches your work every few
 * hours (within your interruption budget) and reads it with these thresholds. Its routines live in Routines too.
 */
export function SecretarySection() {
  const t = useT();
  const [state, setState] = useState<{ profile: SecretaryProfile; routines: Routine[] }>();
  const fail = useCallback(
    (e: unknown) => notify(t("error.secretary", { error: e instanceof Error ? e.message : String(e) })),
    [t],
  );
  useEffect(() => {
    client.call("secretary.get", {}).then(setState).catch(fail);
  }, [fail]);
  if (!state) return null;
  const p = state.profile;
  const save = (patch: Partial<SecretaryProfile>) =>
    void client
      .call("secretary.set", { ...p, ...patch })
      .then(setState)
      .catch(fail);
  const restore = (id: string) =>
    void client
      .call("secretary.restore", { routine: id })
      .then(() => client.call("secretary.get", {}))
      .then(setState)
      .catch(fail);
  const when = (key: "day_open" | "day_close") => {
    const c = parseCron(p[key]);
    if (!c)
      return (
        <Input
          aria-label={t(`sec.${key}`)}
          className="sec__cron"
          defaultValue={p[key]}
          onBlur={(e) => e.currentTarget.value.trim() !== p[key] && save({ [key]: e.currentTarget.value.trim() })}
        />
      );
    return (
      <div className="tgquiet">
        <Input
          aria-label={t(`sec.${key}`)}
          type="time"
          value={c.time}
          onChange={(e) => e.currentTarget.value && save({ [key]: toCron(e.currentTarget.value, c.days) })}
        />
        <Select
          label={t("sec.days")}
          value={c.days}
          onValueChange={(v) => v && save({ [key]: toCron(c.time, v as Days) })}
          options={DAYS.map((d) => ({ value: d, label: t(`sec.days.${d}`) }))}
        />
      </div>
    );
  };
  const num = (
    key: "watch_every_h" | "stale_project_days" | "waiting_hours" | "commitment_lead_hours",
    max: number,
  ) => (
    <Input
      aria-label={t(`sec.${key}`)}
      type="number"
      min={1}
      max={max}
      className="nudge__num"
      value={String(p[key])}
      onChange={(e) => {
        const v = Math.max(1, Math.min(max, Math.round(Number(e.currentTarget.value) || 1)));
        save({ [key]: v });
      }}
    />
  );
  return (
    <>
      <SectionHead
        title={t("config.secretary")}
        lead={t("sec.lead")}
        actions={<Switch checked={p.on} onCheckedChange={(on) => save({ on })} label={t("sec.on")} />}
      />
      <SettingRow title={t("sec.day_open")} description={t("sec.dayOpenHint")}>
        {when("day_open")}
      </SettingRow>
      <SettingRow title={t("sec.day_close")} description={t("sec.dayCloseHint")}>
        {when("day_close")}
      </SettingRow>
      <SettingRow title={t("sec.watch_every_h")} description={t("sec.watchHint")}>
        {num("watch_every_h", 24)}
      </SettingRow>
      <SettingRow title={t("sec.calendar")} description={t("sec.calendarHint")}>
        <Input
          aria-label={t("sec.calendar")}
          className="sec__cron"
          placeholder="apx mcp run calendar list_events …"
          defaultValue={p.calendar_command}
          onBlur={(e) =>
            e.currentTarget.value !== p.calendar_command && save({ calendar_command: e.currentTarget.value })
          }
        />
      </SettingRow>
      <SettingRow title={t("sec.commitment_lead_hours")} description={t("sec.leadHint")}>
        {num("commitment_lead_hours", 720)}
      </SettingRow>
      <SettingRow title={t("sec.waiting_hours")} description={t("sec.waitingHint")}>
        {num("waiting_hours", 720)}
      </SettingRow>
      <SettingRow title={t("sec.stale_project_days")} description={t("sec.staleHint")}>
        {num("stale_project_days", 90)}
      </SettingRow>
      <SettingRow title={t("sec.formality")} description={t("sec.formalityHint")}>
        <SegmentedControl
          size="sm"
          label={t("sec.formality")}
          value={p.formality}
          onValueChange={(v) => save({ formality: v as SecretaryProfile["formality"] })}
          options={(["informal", "neutral", "formal"] as const).map((f) => ({
            value: f,
            label: t(`sec.formality.${f}`),
          }))}
        />
      </SettingRow>
      <SettingRow title={t("sec.budget")} description={t("sec.budgetHint")}>
        <Button size="sm" variant="secondary" onClick={() => go.config("interruptions")}>
          {t("nudge.open")}
        </Button>
      </SettingRow>

      <SubHead>{t("sec.routines")}</SubHead>
      {state.routines.length === 0 && <p className="config__lead">{t("sec.noRoutines")}</p>}
      {state.routines.map((r) => (
        <div key={r.id} className="tgtoken">
          <span className="res__name">{r.name}</span>
          <span className="pform__hint">{r.enabled ? t("routines.on") : t("routines.off")}</span>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Icons.RotateCcw size={14} />}
            onClick={() => restore(r.id)}
            aria-label={t("sec.restore", { name: r.name })}
          >
            {t("sec.restoreShort")}
          </Button>
        </div>
      ))}
    </>
  );
}
