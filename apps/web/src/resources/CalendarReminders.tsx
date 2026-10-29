import type { CalendarReminders as Reminders } from "@apx/protocol";
import { CALENDAR_LEAD, CHECK_EVERY } from "@apx/protocol/client";
import { SettingRow, Skeleton, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { Duration } from "./Duration.tsx";

/** Google Calendar's settings: whether the owner hears of an event before it starts, how long before, and how often Calendar is looked at. */
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
        <Duration
          key={saved.lead_min}
          label={t("int.cal.lead")}
          minutes={saved.lead_min}
          range={CALENDAR_LEAD}
          disabled={!saved.enabled}
          onSave={(lead_min) => void save({ lead_min })}
        />
      </SettingRow>
      <SettingRow title={t("int.cal.every")} description={t("int.cal.everyHint")}>
        <Duration
          key={saved.every_min}
          label={t("int.cal.every")}
          minutes={saved.every_min}
          range={CHECK_EVERY}
          units={["min", "h"]}
          disabled={!saved.enabled}
          onSave={(every_min) => void save({ every_min })}
        />
      </SettingRow>
    </>
  );
}
