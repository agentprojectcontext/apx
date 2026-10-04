import type { Device, NoticePrefs, Nudge } from "@apx/protocol";
import { Badge, Button, EmptyState, Icons, Input, Select, SettingRow, Switch } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { loadChannels, saveNotices, useChannels } from "../data/channels.ts";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { SectionHead, SubHead } from "./SectionHead.tsx";

const STATE_TONE: Record<Nudge["state"], "brand" | "neutral" | "warning" | "danger"> = {
  sent: "brand",
  merged: "brand",
  held: "warning",
  dropped: "neutral",
  no_channel: "danger",
};

/** What the core lets the owner rate: a routine's or an agent's news that went out. */
const rateable = (n: Nudge) =>
  (n.state === "sent" || n.state === "no_channel") && (n.kind.startsWith("routine:") || n.kind.startsWith("agent:"));

/**
 * How often APX may write to you unasked: a daily cap, gaps per project and per kind, quiet hours that hold messages
 * (they go together when the hours end), and what it meant to send lately. Answers to you never count.
 */
export function InterruptionsSection() {
  const t = useT();
  const prefs = useChannels((s) => s.notices);
  const channels = useChannels((s) => s.channels);
  const [devices, setDevices] = useState<Device[]>([]);
  const [log, setLog] = useState<{ items: Nudge[]; today: { sent: number; cap: number } }>();
  const loadLog = useCallback(async () => {
    try {
      setLog(await client.call("notices.log", { limit: 50 }));
    } catch {
      setLog(undefined);
    }
  }, []);
  const rate = async (n: Nudge, feedback: "up" | "down") => {
    const next = await client.call("notices.feedback", {
      id: n.id,
      feedback: n.feedback === feedback ? null : feedback,
    });
    setLog((l) => l && { ...l, items: l.items.map((i) => (i.id === n.id ? next : i)) });
  };
  useEffect(() => {
    void loadChannels();
    void loadLog();
    void client
      .call("devices.list", {})
      .then((r) => setDevices(r.devices))
      .catch(() => setDevices([]));
  }, [loadLog]);
  if (!prefs) return null;
  const save = (patch: Partial<NoticePrefs>) => void saveNotices({ ...prefs, ...patch });
  const quiet = Boolean(prefs.quiet_from && prefs.quiet_to);
  const num = (key: "budget_per_day" | "project_gap_min" | "kind_gap_min", max: number) => (
    <Input
      aria-label={t(`nudge.${key}`)}
      type="number"
      min={0}
      max={max}
      className="nudge__num"
      value={String(prefs[key])}
      onChange={(e) => {
        const v = Math.max(0, Math.min(max, Math.round(Number(e.currentTarget.value) || 0)));
        save({ [key]: v });
      }}
    />
  );
  return (
    <>
      <SectionHead title={t("config.interruptions")} lead={t("nudge.lead")} />
      {log && (
        <p className="config__lead">
          {log.today.cap > 0
            ? t("nudge.today", { sent: log.today.sent, left: Math.max(0, log.today.cap - log.today.sent) })
            : t("nudge.todayNoCap", { sent: log.today.sent })}
        </p>
      )}
      <SettingRow title={t("nudge.where")} description={t("nudge.whereHint")}>
        <Select
          label={t("nudge.where")}
          value={prefs.channel ?? "auto"}
          onValueChange={(v) => save({ channel: v && v !== "auto" ? v : undefined })}
          options={[
            { value: "auto", label: t("nudge.whereAuto") },
            ...channels.map((c) => ({ value: c.id, label: c.account ?? c.label })),
            ...devices
              .filter((d) => d.push)
              .map((d) => ({ value: `device:${d.id}`, label: t("nudge.wherePhone", { name: d.name }) })),
          ]}
        />
      </SettingRow>
      <SettingRow title={t("nudge.budget_per_day")} description={t("nudge.budgetHint")}>
        {num("budget_per_day", 50)}
      </SettingRow>
      <SettingRow title={t("tg.quiet")} description={t("nudge.quietHint")}>
        <div className="tgquiet">
          <Switch
            size="sm"
            checked={quiet}
            onCheckedChange={(on) =>
              save(on ? { quiet_from: "22:00", quiet_to: "07:30" } : { quiet_from: undefined, quiet_to: undefined })
            }
            aria-label={t("tg.quiet")}
          />
          {quiet && (
            <>
              <span className="tgquiet__word">{t("tg.quietFrom")}</span>
              <Input
                aria-label={t("tg.quietFrom")}
                type="time"
                value={prefs.quiet_from ?? ""}
                onChange={(e) => save({ quiet_from: e.currentTarget.value })}
              />
              <span className="tgquiet__word">{t("tg.quietTo")}</span>
              <Input
                aria-label={t("tg.quietTo")}
                type="time"
                value={prefs.quiet_to ?? ""}
                onChange={(e) => save({ quiet_to: e.currentTarget.value })}
              />
            </>
          )}
        </div>
      </SettingRow>
      <SettingRow title={t("nudge.project_gap_min")} description={t("nudge.projectGapHint")}>
        {num("project_gap_min", 1440)}
      </SettingRow>
      <SettingRow title={t("nudge.kind_gap_min")} description={t("nudge.kindGapHint")}>
        {num("kind_gap_min", 1440)}
      </SettingRow>
      <SettingRow title={t("nudge.criticalBudget")} description={t("nudge.criticalBudgetHint")}>
        <Switch
          size="sm"
          checked={prefs.critical_skips_budget}
          onCheckedChange={(on) => save({ critical_skips_budget: on })}
          aria-label={t("nudge.criticalBudget")}
        />
      </SettingRow>
      <SettingRow title={t("nudge.criticalWakes")} description={t("nudge.criticalWakesHint")}>
        <Switch
          size="sm"
          checked={prefs.critical_wakes}
          onCheckedChange={(on) => save({ critical_wakes: on })}
          aria-label={t("nudge.criticalWakes")}
        />
      </SettingRow>

      <SubHead>{t("nudge.log")}</SubHead>
      {log?.items.length === 0 && (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Bell />}>
          {t("nudge.logEmpty")}
        </EmptyState>
      )}
      <ul className="nudge__log">
        {log?.items.map((n) => (
          <li key={n.id} className="nudge__item">
            <div className="nudge__head">
              <code className="nudge__kind">{n.kind}</code>
              <span className="nudge__at">{n.at.slice(0, 16).replace("T", " ")}</span>
              <Badge tone={STATE_TONE[n.state]}>{t(`nudge.state.${n.state}`)}</Badge>
              {n.exempt && <Badge>{t("nudge.exempt")}</Badge>}
            </div>
            <p className="nudge__text">{n.text.length > 280 ? `${n.text.slice(0, 280)}…` : n.text}</p>
            {n.reason && <p className="nudge__reason">{n.reason}</p>}
            {rateable(n) && (
              <div className="nudge__rate">
                {(["up", "down"] as const).map((f) => (
                  <Button
                    key={f}
                    size="sm"
                    variant={n.feedback === f ? "secondary" : "ghost"}
                    aria-pressed={n.feedback === f}
                    aria-label={t(f === "up" ? "nudge.useful" : "nudge.notUseful")}
                    onClick={() => void rate(n, f).catch(() => {})}
                  >
                    {f === "up" ? "👍" : "👎"}
                  </Button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
