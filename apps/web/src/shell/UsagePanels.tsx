import type { DiskSpace, SystemUsage } from "@apx/protocol";
import { Button, Dialog, IconButton, Icons, Meter, Skeleton } from "@apx/ui";
import "../styles/usage.css";
import { refreshUsage, useUsage } from "../data/usage.ts";
import { type DesktopMemory, homeDisk, type ProcessRow, processRows, ramSplit, size } from "../data/usageModel.ts";
import { type T, usePack, useT } from "../i18n/index.ts";
import { go, useNav } from "./nav.ts";

/** The topbar dropdown: RAM, CPU, disk free, APX's top consumers and the VM, with a way to the full dialog. */
export function UsageSummary(props: { onClose: () => void }) {
  return usePack("usage") ? <Summary {...props} /> : null;
}

function Summary({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { usage, desktop, error } = useUsage({ detail: true, every: 5_000 });
  if (!usage) return error ? <p className="usage__error">{t("sysUsage.unavailable", { error })}</p> : <Loading />;
  const disk = homeDisk(usage);
  return (
    <div className="usage usage--compact" data-testid="usage-summary">
      <MemoryBlock t={t} usage={usage} desktop={desktop} />
      <CpuBlock t={t} usage={usage} />
      {disk && <DiskRow t={t} disk={disk} />}
      {usage.vm && <VmBlock t={t} vm={usage.vm} />}
      <section className="usage__block">
        <h3 className="usage__head">{t("sysUsage.top")}</h3>
        <ProcessList t={t} rows={processRows(usage, desktop)} limit={4} />
      </section>
      <button
        type="button"
        className="usage__more"
        onClick={() => {
          onClose();
          go.usageDialog(true);
        }}
      >
        {t("sysUsage.openFull")}
        <Icons.ChevronRight size={14} />
      </button>
    </div>
  );
}

/** The full breakdown from the account menu: every process, every volume, the APX folder by part, the VM. */
// Its strings load with it (usePack in index.ts): none of them is on the first screen.
export function UsageDialog() {
  return usePack("usage") ? <UsageDialogBody /> : null;
}

function UsageDialogBody() {
  const t = useT();
  const open = useNav((s) => s.usageDialog);
  return (
    <Dialog
      open={open}
      onOpenChange={go.usageDialog}
      size="xl"
      className="usage-dialog"
      title={t("sysUsage.title")}
      description={t("sysUsage.description")}
      closeLabel={t("common.close")}
      footer={
        <Button variant="secondary" onClick={() => go.usageDialog(false)}>
          {t("common.close")}
        </Button>
      }
    >
      {open && <UsageDetail />}
    </Dialog>
  );
}

function UsageDetail() {
  const t = useT();
  const { usage, desktop, error } = useUsage({ detail: true, every: 5_000 });
  if (!usage) return error ? <p className="usage__error">{t("sysUsage.unavailable", { error })}</p> : <Loading />;
  const rows = processRows(usage, desktop);
  const apxMb = rows.reduce((n, r) => n + r.mb, 0);
  return (
    <div className="usage usage--full" data-testid="usage-detail">
      <div className="usage__cols">
        <div className="usage__col">
          <MemoryBlock t={t} usage={usage} desktop={desktop} />
          <CpuBlock t={t} usage={usage} />
          <section className="usage__block">
            <h3 className="usage__head">{t("sysUsage.disk")}</h3>
            {usage.host.disks.map((d) => (
              <DiskRow key={d.path} t={t} disk={d} named />
            ))}
          </section>
          {usage.vm && <VmBlock t={t} vm={usage.vm} />}
        </div>
        <div className="usage__col">
          <section className="usage__block">
            <div className="usage__headrow">
              <h3 className="usage__head">{t("sysUsage.processes")}</h3>
              <IconButton
                size="sm"
                label={t("sysUsage.refresh")}
                icon={<Icons.RefreshCw size={13} />}
                onClick={refreshUsage}
              />
            </div>
            <p className="usage__note">{t("desktop.memoryHint", { total: size(apxMb) })}</p>
            <ProcessList t={t} rows={rows} limit={14} />
          </section>
          <HomeBlock t={t} usage={usage} />
        </div>
      </div>
    </div>
  );
}

/** Settings › Advanced: memory and disk at a glance, and the dialog for the rest. */
export function UsageOverview() {
  return usePack("usage") ? <Overview /> : null;
}

function Overview() {
  const t = useT();
  const { usage, desktop } = useUsage({ detail: false, every: 10_000 });
  if (!usage) return <Loading />;
  const disk = homeDisk(usage);
  return (
    <div className="usage usage--overview" data-testid="usage-overview">
      <MemoryBlock t={t} usage={usage} desktop={desktop} />
      {disk && <DiskRow t={t} disk={disk} />}
      <div>
        <Button size="sm" variant="secondary" onClick={() => go.usageDialog(true)}>
          {t("sysUsage.openFull")}
        </Button>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="usage">
      <Skeleton width="40%" />
      <Skeleton height={8} />
      <Skeleton width="70%" />
    </div>
  );
}

function MemoryBlock({ t, usage, desktop }: { t: T; usage: SystemUsage; desktop: DesktopMemory | undefined }) {
  const r = ramSplit(usage, desktop);
  return (
    <section className="usage__block">
      <div className="usage__headrow">
        <h3 className="usage__head">
          <Icons.MemoryStick size={13} />
          {t("sysUsage.memory")}
        </h3>
        <span className="usage__figure">{t("sysUsage.memoryOf", { used: size(r.used), total: size(r.total) })}</span>
      </div>
      <Meter
        label={t("sysUsage.memory")}
        max={r.total}
        valueText={t("sysUsage.memoryOf", { used: size(r.used), total: size(r.total) })}
        legend
        segments={[
          { value: r.apx, tone: "brand", label: t("sysUsage.apx", { size: size(r.apx) }) },
          ...(r.vm ? [{ value: r.vm, tone: "violet" as const, label: t("sysUsage.vm", { size: size(r.vm) }) }] : []),
          { value: r.other, tone: "muted", label: t("sysUsage.other", { size: size(r.other) }) },
        ]}
      />
      <span className="usage__note">{t("sysUsage.free", { size: size(r.free) })}</span>
    </section>
  );
}

function CpuBlock({ t, usage }: { t: T; usage: SystemUsage }) {
  const { host, core } = usage;
  return (
    <section className="usage__block">
      <div className="usage__headrow">
        <h3 className="usage__head">
          <Icons.Cpu size={13} />
          {t("sysUsage.cpu")}
        </h3>
        {host.cpu_pct !== undefined && (
          <span className="usage__figure">{t("sysUsage.cpuBusy", { pct: host.cpu_pct })}</span>
        )}
      </div>
      {host.cpu_pct !== undefined && <Meter size="sm" label={t("sysUsage.cpu")} value={host.cpu_pct} max={100} />}
      <span className="usage__note">
        {t("sysUsage.cpuCores", { n: host.cpus, load: host.load[0] ?? 0 })}
        {core.cpu_pct !== undefined && ` · ${t("sysUsage.coreCpu", { pct: core.cpu_pct })}`}
      </span>
    </section>
  );
}

function DiskRow({ t, disk, named }: { t: T; disk: DiskSpace; named?: boolean }) {
  const role =
    disk.roles.length > 1
      ? "sysUsage.disk.both"
      : disk.roles[0] === "home"
        ? "sysUsage.disk.home"
        : "sysUsage.disk.system";
  const free = t("sysUsage.diskFree", { free: size(disk.free_mb), total: size(disk.total_mb) });
  return (
    <div className="usage__block usage__disk">
      <div className="usage__headrow">
        <span className="usage__head">
          <Icons.HardDrive size={13} />
          {named ? t(role) : t("sysUsage.disk")}
        </span>
        <span className="usage__figure">{free}</span>
      </div>
      <Meter label={t(role)} valueText={free} value={disk.total_mb - disk.free_mb} max={disk.total_mb} />
    </div>
  );
}

function VmBlock({ t, vm }: { t: T; vm: NonNullable<SystemUsage["vm"]> }) {
  const memory =
    vm.memory_assigned_mb !== undefined
      ? vm.memory_used_mb !== undefined
        ? t("sysUsage.vm.memory", { used: size(vm.memory_used_mb), assigned: size(vm.memory_assigned_mb) })
        : t("sysUsage.vm.assigned", { assigned: size(vm.memory_assigned_mb) })
      : undefined;
  const facts = [
    memory,
    vm.cpus !== undefined ? t("sysUsage.vm.cpus", { n: vm.cpus }) : undefined,
    vm.disk_mb !== undefined ? t("sysUsage.vm.disk", { size: size(vm.disk_mb) }) : undefined,
  ].filter(Boolean);
  return (
    <section className="usage__block" data-testid="usage-vm">
      <div className="usage__headrow">
        <h3 className="usage__head">
          <Icons.Server size={13} />
          {vm.name ?? t("sysUsage.vmTitle")}
        </h3>
        <span className={vm.running ? "usage__state is-on" : "usage__state"}>
          {t(vm.running ? "sysUsage.vm.running" : "sysUsage.vm.stopped")}
        </span>
      </div>
      {vm.running && vm.memory_assigned_mb !== undefined && vm.memory_used_mb !== undefined && (
        <Meter size="sm" label={t("sysUsage.vmTitle")} value={vm.memory_used_mb} max={vm.memory_assigned_mb} />
      )}
      {facts.length > 0 && <span className="usage__note">{facts.join(" · ")}</span>}
    </section>
  );
}

function processName(t: T, r: ProcessRow): string {
  return `${t(`desktop.memory.${r.kind}`)}${r.site ? ` · ${r.site}` : ""}`;
}

function ProcessList({ t, rows, limit }: { t: T; rows: ProcessRow[]; limit: number }) {
  const max = rows[0]?.mb ?? 0;
  return (
    <ul className="usage__list">
      {rows.slice(0, limit).map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two helpers can share a name
        <li key={i} className="usage__row">
          <span className="usage__name" title={processName(t, r)}>
            {processName(t, r)}
          </span>
          <span className="usage__bar" aria-hidden="true">
            <span style={{ width: `${max ? (r.mb / max) * 100 : 0}%` }} />
          </span>
          <span className="usage__value">{size(r.mb)}</span>
        </li>
      ))}
    </ul>
  );
}

function HomeBlock({ t, usage }: { t: T; usage: SystemUsage }) {
  const home = usage.home;
  const measured = home?.measured_at !== undefined;
  const max = home?.parts[0]?.mb ?? 0;
  return (
    <section className="usage__block" data-testid="usage-home">
      <div className="usage__headrow">
        <h3 className="usage__head">
          <Icons.Folder size={13} />
          {t("sysUsage.home")}
        </h3>
        <span className="usage__figure">
          {measured ? t("sysUsage.homeTotal", { total: size(home?.total_mb ?? 0) }) : t("sysUsage.measuring")}
        </span>
      </div>
      {measured ? (
        <ul className="usage__list">
          {home?.parts.map((p) => (
            <li key={p.id} className="usage__row">
              <span className="usage__name">{t(`sysUsage.part.${p.id}`)}</span>
              <span className="usage__bar" aria-hidden="true">
                <span style={{ width: `${max ? (p.mb / max) * 100 : 0}%` }} />
              </span>
              <span className="usage__value">{size(p.mb)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Skeleton height={60} shape="block" />
      )}
      {home?.partial && <span className="usage__note">{t("sysUsage.partial")}</span>}
    </section>
  );
}
