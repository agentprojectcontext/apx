import type { MemorySettings } from "@apx/protocol";
import { DAILY_MEMORY_CALLS } from "@apx/protocol/client";
import { Button, Input, SettingRow, Switch } from "@apx/ui";
import { projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { memoryJobText } from "./memoryJobText.ts";
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
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
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
          value={String(settings.daily_memory_calls ?? DAILY_MEMORY_CALLS)}
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
          {jobs.slice(0, 6).map((job) => {
            const place = job.project_id ? projectName(projects, job.project_id) : undefined;
            const text = memoryJobText(job, t, agents[job.agent_id]?.name ?? t("memory.byAgent"), place);
            return (
              <li key={job.id} className="res__row">
                <div className="res__main">
                  <div className="res__name">{text.name}</div>
                  <div className="res__desc">{text.desc}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
