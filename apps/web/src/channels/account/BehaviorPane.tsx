import type { ChannelHours, ChannelResearch } from "@apx/protocol";
import { CHANNEL_DEFAULTS } from "@apx/protocol/client";
import { Input, SegmentedControl, SettingRow, Switch, Textarea } from "@apx/ui";
import { WeekDays } from "../../common/pickers/WeekDays.tsx";
import type { ChannelDraft } from "../../data/channels.ts";
import { useOwnerTimeZone } from "../../data/owner.ts";
import { useT } from "../../i18n/index.ts";
import type { PaneProps } from "./types.ts";

/** Hours a channel starts with when the owner turns them on: every day, a working day's span. */
const FIRST_HOURS: ChannelHours = { days: [1, 2, 3, 4, 5, 6, 0], from: "08:00", to: "22:00" };

/** How it answers: a message while it works, the web, its hours, whom, and the owner's notes and rules for it. */
export function BehaviorPane({ draft, set }: Pick<PaneProps, "draft" | "set">) {
  const t = useT();
  const research = draft.research ?? CHANNEL_DEFAULTS.research;
  return (
    <>
      <SettingRow title={t("tg.concurrency")} description={t(`ch.concurrencyHint.${draft.concurrency}`)}>
        <SegmentedControl
          size="sm"
          label={t("tg.concurrency")}
          value={draft.concurrency}
          onValueChange={(v) => set({ concurrency: v as ChannelDraft["concurrency"] })}
          options={[
            { value: "queue", label: t("tg.concurrency.queue") },
            { value: "interrupt", label: t("tg.concurrency.interrupt") },
            { value: "steer", label: t("tg.concurrency.steer") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("ch.research")} description={t(`ch.researchHint.${research}`)}>
        <SegmentedControl
          size="sm"
          label={t("ch.research")}
          value={research}
          onValueChange={(v) => set({ research: v as ChannelResearch })}
          options={[
            { value: "off", label: t("ch.research.off") },
            { value: "owner", label: t("ch.research.owner") },
            { value: "everyone", label: t("ch.research.everyone") },
          ]}
        />
      </SettingRow>
      <Hours hours={draft.hours} set={set} />
      <SettingRow title={t("acct.ownerOnly")} description={t("acct.ownerOnlyHint")}>
        <Switch
          size="sm"
          checked={draft.owner_only === true}
          onCheckedChange={(on) => set({ owner_only: on })}
          aria-label={t("acct.ownerOnly")}
        />
      </SettingRow>
      <div className="pform__field">
        <span className="pform__label">{t("acct.knowledge")}</span>
        <Textarea
          aria-label={t("acct.knowledge")}
          rows={5}
          maxLength={12_000}
          value={draft.knowledge ?? ""}
          onChange={(e) => set({ knowledge: e.currentTarget.value })}
        />
        <span className="pform__hint">{t("acct.knowledgeHint")}</span>
      </div>
      <div className="pform__field">
        <span className="pform__label">{t("acct.rules")}</span>
        <Textarea
          aria-label={t("acct.rules")}
          rows={3}
          maxLength={2000}
          value={draft.rules ?? ""}
          onChange={(e) => set({ rules: e.currentTarget.value })}
        />
        <span className="pform__hint">{t("acct.rulesHint")}</span>
      </div>
    </>
  );
}

/** When it answers contacts, in the owner's time zone: at any hour, or on some days between two times. */
function Hours({ hours, set }: { hours: ChannelHours | undefined; set: PaneProps["set"] }) {
  const t = useT();
  const zone = useOwnerTimeZone();
  const change = (patch: Partial<ChannelHours>) => hours && set({ hours: { ...hours, ...patch } });
  const time = (key: "from" | "to", label: string) => (
    <Input
      className="chhours__time"
      aria-label={label}
      type="time"
      value={hours?.[key] ?? ""}
      onChange={(e) => e.currentTarget.value && change({ [key]: e.currentTarget.value })}
    />
  );
  return (
    <>
      <SettingRow title={t("ch.hours")} description={t(hours ? "ch.hoursHint.on" : "ch.hoursHint.off")}>
        <Switch
          size="sm"
          checked={Boolean(hours)}
          onCheckedChange={(on) => set({ hours: on ? FIRST_HOURS : undefined })}
          aria-label={t("ch.hours")}
        />
      </SettingRow>
      {hours && (
        <SettingRow
          stacked
          title={t("ch.hoursWhen")}
          description={zone ? t("ch.hoursZone", { zone }) : t("ch.hoursZoneLocal")}
        >
          <div className="chhours">
            <WeekDays days={hours.days} label={t("ch.hoursDays")} onChange={(days) => change({ days })} />
            <span className="chhours__span">
              <span className="tgquiet__word">{t("tg.quietFrom")}</span>
              {time("from", t("tg.quietFrom"))}
              <span className="tgquiet__word">{t("tg.quietTo")}</span>
              {time("to", t("tg.quietTo"))}
            </span>
          </div>
        </SettingRow>
      )}
    </>
  );
}
