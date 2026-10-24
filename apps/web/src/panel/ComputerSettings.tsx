import type { Result } from "@apx/protocol";
import { Select, SettingRow } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

type Status = Result<"environments.status">;
type Key = "memory_gib" | "cpus" | "disk_gib";

const IDLE = [0, 15, 30, 60, 120];
const DISK_STEPS = [16, 24, 32, 48, 64, 96, 128, 192, 256];

/** The VM's memory, CPUs, disk and idle shutdown, within this host's limits; they apply on its next start. */
export function ComputerSettings({ status, onSaved }: { status: Status; onSaved: (error?: string) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const { resources, limits } = status;
  if (!resources || !limits) return null;
  const save = async (change: Partial<Record<Key | "idle_minutes", number>>) => {
    setBusy(true);
    try {
      await client.call("environments.configure", change);
      onSaved();
    } catch (failure) {
      onSaved(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const disks = DISK_STEPS.filter((d) => d >= (status.disk_min_gib ?? limits.disk_gib.min) && d <= limits.disk_gib.max);
  if (!disks.includes(resources.disk_gib)) disks.push(resources.disk_gib);
  const choice = (key: Key, values: number[], label: (n: number) => string) => (
    <Select
      size="sm"
      label={t(`computer.${key}`)}
      value={String(resources[key])}
      disabled={busy}
      onValueChange={(v) => v && void save({ [key]: Number(v) })}
      options={values.sort((a, b) => a - b).map((n) => ({ value: String(n), label: label(n) }))}
    />
  );
  return (
    <section className="computer__settings" aria-label={t("computer.settings")}>
      <SettingRow title={t("computer.memory_gib")}>
        {choice("memory_gib", range(limits.memory_gib.min, limits.memory_gib.max), (n) => `${n} GiB`)}
      </SettingRow>
      <SettingRow title={t("computer.cpus")}>
        {choice("cpus", range(limits.cpus.min, limits.cpus.max), String)}
      </SettingRow>
      <SettingRow title={t("computer.disk_gib")} description={t("computer.diskGrows")}>
        {choice("disk_gib", disks, (n) => `${n} GiB`)}
      </SettingRow>
      <SettingRow title={t("computer.idle")} description={t("computer.idleHint")}>
        <Select
          size="sm"
          label={t("computer.idle")}
          value={String(status.idle_minutes ?? 30)}
          disabled={busy}
          onValueChange={(v) => v && void save({ idle_minutes: Number(v) })}
          options={IDLE.map((n) => ({
            value: String(n),
            label: n ? t("computer.idleMinutes", { n }) : t("computer.idleNever"),
          }))}
        />
      </SettingRow>
      {status.restart && <p role="status">{t("computer.restartHint")}</p>}
    </section>
  );
}
