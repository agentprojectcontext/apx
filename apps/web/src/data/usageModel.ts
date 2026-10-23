// What the usage views show, from system.usage and the desktop app's process list: pure, so the three views (topbar
// dropdown, dialog, Settings › Advanced) count the same way. Polling lives here too, shared by whoever is looking.
import type { SystemUsage } from "@apx/protocol";

export type DesktopKind = "main" | "gpu" | "panel" | "quick" | "tab" | "page" | "app" | "helper";
export type DesktopMemory = {
  total_mb: number;
  items: Array<{ pid: number; kind: DesktopKind; site?: string; mb: number }>;
};
export type ProcessRow = { kind: "core" | DesktopKind; site?: string; mb: number; cpu_pct?: number };

/** "850 MB" / "6.2 GB" / "1.2 TB". */
export function size(mb: number): string {
  if (mb >= 1024 * 1024) return `${(mb / 1048576).toFixed(1)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** The core and each of the desktop app's processes, biggest first. */
export function processRows(usage: SystemUsage | undefined, desktop: DesktopMemory | undefined): ProcessRow[] {
  const core: ProcessRow[] = usage
    ? [
        {
          kind: "core",
          mb: usage.core.rss_mb,
          ...(usage.core.cpu_pct !== undefined ? { cpu_pct: usage.core.cpu_pct } : {}),
        },
      ]
    : [];
  const own = (desktop?.items ?? []).map(
    (i): ProcessRow => ({ kind: i.kind, mb: i.mb, ...(i.site ? { site: i.site } : {}) }),
  );
  return [...core, ...own].sort((a, b) => b.mb - a.mb);
}

export type RamSplit = { total: number; apx: number; vm: number; other: number; free: number; used: number };

/** The computer's RAM as APX, the VM, everything else, and what is still free. */
export function ramSplit(usage: SystemUsage, desktop: DesktopMemory | undefined): RamSplit {
  const total = usage.host.memory_total_mb;
  const free = Math.min(total, usage.host.memory_available_mb);
  const used = total - free;
  const apx = Math.min(used, usage.core.rss_mb + (desktop?.total_mb ?? 0));
  const vmMb = usage.vm?.running ? (usage.vm.memory_used_mb ?? usage.vm.memory_assigned_mb ?? 0) : 0;
  const vm = Math.min(used - apx, vmMb);
  return { total, apx, vm, other: Math.max(0, used - apx - vm), free, used };
}

/** The volume holding the APX home (the first one when there is no home role). */
export const homeDisk = (usage: SystemUsage) =>
  usage.host.disks.find((d) => d.roles.includes("home")) ?? usage.host.disks[0];

export type Watch = { detail: boolean; every: number };
export type Snapshot = { usage?: SystemUsage; desktop?: DesktopMemory; error?: string; detail: boolean };

/**
 * One poll for every view looking: as often as the most eager one asks, with the home's size and the desktop's
 * processes only while one wants detail. Nobody looking, nothing is asked.
 */
export function createUsagePoller(o: {
  read: (detail: boolean) => Promise<Omit<Snapshot, "detail">>;
  onSnapshot: (s: Snapshot) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  now?: () => number;
}) {
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const now = o.now ?? Date.now;
  const watches = new Map<number, Watch>();
  let next = 0;
  let timer: unknown;
  let lastAt = Number.NEGATIVE_INFINITY;
  let lastDetail = false;
  let inFlight = false;

  const want = () => {
    const all = [...watches.values()];
    return { detail: all.some((w) => w.detail), every: Math.min(...all.map((w) => w.every)) };
  };
  const tick = async () => {
    if (!watches.size || inFlight) return;
    const { detail } = want();
    inFlight = true;
    try {
      o.onSnapshot({ ...(await o.read(detail)), detail });
    } catch (e) {
      o.onSnapshot({ error: e instanceof Error ? e.message : String(e), detail });
    } finally {
      inFlight = false;
      lastAt = now();
      lastDetail = detail;
      schedule();
    }
  };
  const schedule = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    if (!watches.size) return;
    const { detail, every } = want();
    const due = (detail && !lastDetail) || now() - lastAt >= every;
    timer = setTimer(() => void tick(), due ? 0 : every - (now() - lastAt));
  };
  return {
    watch(w: Watch): () => void {
      const id = next++;
      watches.set(id, w);
      schedule();
      return () => {
        watches.delete(id);
        schedule();
      };
    },
    /** Read now (a refresh button), whoever is watching. */
    refresh: () => {
      lastAt = Number.NEGATIVE_INFINITY;
      schedule();
    },
  };
}
