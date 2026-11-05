// What the computer has and what APX takes of it (system.usage). Host numbers are read on each call, cheaply; the
// APX home's size is the storage screen's measure (storage.ts), walked in the background and kept for a while.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import type { DiskSpace, HomeUsage, SystemUsage, VmUsage } from "@apx/protocol";
import { createStorage } from "./storage.ts";

const MB = 1048576;
const mb = (bytes: number) => Math.round(bytes / MB);

/** Memory apps can still take. macOS: total minus app memory, wired and compressed (as Activity Monitor counts). */
export function availableFromVmStat(out: string, totalBytes: number): number | undefined {
  const pageSize = Number(/page size of (\d+) bytes/.exec(out)?.[1] ?? 4096);
  const pages = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] ?? Number.NaN);
  const used =
    pages("Anonymous pages") -
    pages("Pages purgeable") +
    pages("Pages wired down") +
    pages("Pages occupied by compressor");
  return Number.isFinite(used) ? Math.max(0, totalBytes - used * pageSize) : undefined;
}

export function availableFromMeminfo(text: string): number | undefined {
  const kb = /^MemAvailable:\s+(\d+) kB/m.exec(text)?.[1];
  return kb ? Number(kb) * 1024 : undefined;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 2_000 }, (err, out) => (err ? reject(err) : resolve(out))),
  );
}

/** What apps can still take now; also the shared computer's start check and watchdog read it. */
export async function availableMemory(platform: NodeJS.Platform = process.platform): Promise<number> {
  const total = os.totalmem();
  try {
    if (platform === "darwin") return availableFromVmStat(await run("vm_stat", []), total) ?? os.freemem();
    if (platform === "linux")
      return availableFromMeminfo(await fs.promises.readFile("/proc/meminfo", "utf8")) ?? os.freemem();
  } catch {}
  return os.freemem();
}

async function disks(home: string, platform: NodeJS.Platform): Promise<DiskSpace[]> {
  const system = platform === "win32" ? `${process.env.SystemDrive ?? "C:"}\\` : "/";
  const out: (DiskSpace & { dev: number })[] = [];
  for (const [role, p] of [
    ["home", home],
    ["system", system],
  ] as const) {
    try {
      const [st, dev] = await Promise.all([fs.promises.statfs(p), fs.promises.stat(p)]);
      const same = out.find((d) => d.dev === dev.dev);
      if (same) {
        same.roles.push(role);
        continue;
      }
      out.push({
        roles: [role],
        path: p,
        total_mb: mb(st.blocks * st.bsize),
        free_mb: mb(st.bavail * st.bsize),
        dev: dev.dev,
      });
    } catch {}
  }
  return out.map(({ dev: _, ...d }) => d);
}

/** Busy share since the previous sample, from the CPUs' cumulative times. */
function cpuBusy(): { busy: number; total: number } {
  let busy = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    busy += t.user + t.nice + t.sys + t.irq;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { busy, total };
}

/** The VM's provider gets a few seconds: a stuck hypervisor never holds the whole answer. */
async function vmNow(vm: UsageOptions["vm"]): Promise<VmUsage | undefined> {
  if (!vm) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), 3_000);
  });
  try {
    return await Promise.race([(async () => vm())(), late]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export type UsageOptions = {
  home: string;
  /** The Linux VM's numbers, when there is one. */
  vm?: () => Promise<VmUsage | undefined> | VmUsage | undefined;
  /** The APX home by part: the storage screen's measure, so both count the same way. */
  storage?: { home(): HomeUsage };
  platform?: NodeJS.Platform;
  /** The clock CPU windows are measured on, and the CPUs' cumulative times (tests move both). */
  now?: () => number;
  cpuTimes?: () => { busy: number; total: number };
};

export type Usage = { read(o: { disk: boolean }): Promise<SystemUsage> };

const CPU_WINDOW_MS = 1000;

export function createUsage(o: UsageOptions): Usage {
  const platform = o.platform ?? process.platform;
  const storage = o.storage ?? createStorage({ home: o.home });
  const clock = o.now ?? (() => performance.now());
  const cpuTimes = o.cpuTimes ?? cpuBusy;
  let prevHost = cpuTimes();
  let prevCore = { cpu: process.cpuUsage(), at: clock() };
  let hostPct: number | undefined;
  let corePct: number | undefined;

  return {
    async read({ disk }) {
      const [available, disksNow, vm] = await Promise.all([
        availableMemory(platform),
        disks(o.home, platform),
        vmNow(o.vm),
      ]);
      // A share over a few ms says nothing, and every caller reads here: a window is closed only once it spans a
      // second, and until then each read gets the last share measured.
      const now = { cpu: process.cpuUsage(), at: clock() };
      if (now.at - prevCore.at >= CPU_WINDOW_MS) {
        const host = cpuTimes();
        const dTotal = host.total - prevHost.total;
        hostPct = dTotal > 0 ? Math.round(((host.busy - prevHost.busy) / dTotal) * 100) : undefined;
        prevHost = host;
        const wallUs = (now.at - prevCore.at) * 1000;
        const usedUs = now.cpu.user - prevCore.cpu.user + now.cpu.system - prevCore.cpu.system;
        corePct = Math.round((usedUs / wallUs) * 100);
        prevCore = now;
      }
      const mem = process.memoryUsage();
      return {
        at: new Date().toISOString(),
        host: {
          platform,
          memory_total_mb: mb(os.totalmem()),
          memory_available_mb: mb(available),
          cpus: os.availableParallelism(),
          load: os.loadavg().map((l) => Math.round(l * 100) / 100),
          ...(hostPct !== undefined ? { cpu_pct: hostPct } : {}),
          disks: disksNow,
        },
        core: {
          pid: process.pid,
          rss_mb: mb(mem.rss),
          heap_mb: mb(mem.heapUsed),
          ...(corePct !== undefined ? { cpu_pct: corePct } : {}),
        },
        ...(disk ? { home: storage.home() } : {}),
        ...(vm ? { vm } : {}),
      };
    },
  };
}
