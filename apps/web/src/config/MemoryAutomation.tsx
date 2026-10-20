import type { MemorySettings } from "@apx/protocol";
import { Button, Input, SettingRow, Switch } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";
import { useMemoryAutomation } from "./useMemoryAutomation.ts";

export function MemoryAutomation({
  settings,
  save,
}: {
  settings: MemorySettings;
  save: (patch: Partial<MemorySettings>) => Promise<void>;
}) {
  const t = useT();
  const { jobs, busy, run } = useMemoryAutomation();
  return (
    <>
      <SubHead>{t("mem.continuity")}</SubHead>
      {(["auto_recall", "auto_capture", "auto_dream"] as const).map((key) => (
        <SettingRow key={key} title={t(`mem.${key}`)} description={t(`mem.${key}.hint`)}>
          <Switch
            size="sm"
            checked={settings[key] !== false}
            disabled={settings.mode === "off"}
            onCheckedChange={(on) => void save({ [key]: on })}
            aria-label={t(`mem.${key}`)}
          />
        </SettingRow>
      ))}
      <SettingRow title={t("mem.dailyCalls")} description={t("mem.dailyCalls.hint")}>
        <Input
          type="number"
          min={0}
          max={200}
          value={String(settings.daily_memory_calls ?? 20)}
          aria-label={t("mem.dailyCalls")}
          onChange={(e) => {
            const value = Number(e.currentTarget.value);
            if (Number.isInteger(value) && value >= 0 && value <= 200) void save({ daily_memory_calls: value });
          }}
        />
      </SettingRow>
      <div className="tgtoken">
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={settings.mode === "off"}
          onClick={() => void run(true)}
        >
          {t("mem.backfill")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || settings.mode === "off"}
          onClick={() => void run(false)}
        >
          {t("mem.dreamNow")}
        </Button>
      </div>
      {jobs.length > 0 && (
        <ul className="res__list">
          {jobs.slice(0, 6).map((job) => (
            <li key={job.id} className="res__row">
              <div className="res__main">
                <div className="res__name">{t(job.kind === "dream" ? "mem.auto_dream" : "mem.auto_capture")}</div>
                <div className="res__desc">
                  {t(
                    job.state === "completed"
                      ? "mem.job.completed"
                      : job.state === "failed"
                        ? "mem.job.failed"
                        : job.state === "working"
                          ? "mem.job.working"
                          : "mem.job.pending",
                  )}
                  {job.error ? ` · ${job.error}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
