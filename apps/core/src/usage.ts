// What the computer has and what APX takes of it (system.usage). Host numbers are read on each call, cheaply; the
// APX home's size is a walk of every file, so it runs in the background with a deadline and is kept for a while.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiskSpace, HomePart, HomeUsage, SystemUsage, VmUsage } from "@apx/protocol";

const MB = 1048576;
const mb = (bytes: number) => Math.round(bytes / MB);

/** Top-level entries of the APX home by part; files ending in a database suffix are databases wherever they are. */
const PART_OF: Record<string, HomePart> = {
  backups: "databases",
  logs: "logs",
  jobs: "logs",
  models: "models",
  artifacts: "files",
  media: "files",
  "codex-images": "files",
  browser: "browser",
  projects: "projects",
  work: "projects",
  skills: "projects",
  computer: "computer",
  labs: "computer",
};
const DATABASE = /\.(db|sqlite)(-wal|-shm|-journal)?$/;

export function partOf(name: string): HomePart {
  return PART_OF[name] ?? (DATABASE.test(name) ? "databases" : "other");
}

/** Bytes a tree takes on disk (allocated blocks, so a sparse VM image counts what it holds), symlinks not followed. */
async function treeBytes(dir: string, until: number): Promise<{ bytes: number; partial: boolean }> {
  let bytes = 0;
  const stack = [dir];
  while (stack.length) {
    if (Date.now() > until) return { bytes, partial: true };
    const cur = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    const files: string[] = [];
    for (const e of entries) (e.isDirectory() ? stack : files).push(path.join(cur, e.name));
    for (const n of await Promise.all(files.map(sizeOf))) bytes += n;
  }
  return { bytes, partial: false };
}

async function sizeOf(p: string): Promise<number> {
  try {
    const st = await fs.promises.lstat(p);
    return st.blocks !== undefined && st.blocks > 0 ? st.blocks * 512 : st.size;
  } catch {
    return 0;
  }
}

/** The home's size by part, giving up at the deadline with what it counted (marked partial). */
export async function measureHome(home: string, deadlineMs: number): Promise<Omit<HomeUsage, "measuring">> {
  const until = Date.now() + deadlineMs;
  const totals = new Map<HomePart, number>();
  let partial = false;
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(home, { withFileTypes: true });
  } catch {}
  for (const e of entries) {
    const p = path.join(home, e.name);
    const r = e.isDirectory() ? await treeBytes(p, until) : { bytes: await sizeOf(p), partial: false };
    partial ||= r.partial;
    const part = partOf(e.name);
    totals.set(part, (totals.get(part) ?? 0) + r.bytes);
  }
  const parts = [...totals]
    .map(([id, bytes]) => ({ id, mb: mb(bytes) }))
    .filter((p) => p.mb > 0)
    .sort((a, b) => b.mb - a.mb);
  return {
    measured_at: new Date().toISOString(),
    ...(partial ? { partial } : {}),
    total_mb: parts.reduce((n, p) => n + p.mb, 0),
    parts,
  };
}

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
  /** How long a home measure stays good, and how long one may walk. */
  homeTtlMs?: number;
  homeDeadlineMs?: number;
  platform?: NodeJS.Platform;
  /** The clock CPU windows are measured on, and the CPUs' cumulative times (tests move both). */
  now?: () => number;
  cpuTimes?: () => { busy: number; total: number };
};

export type Usage = { read(o: { disk: boolean }): Promise<SystemUsage> };

const CPU_WINDOW_MS = 1000;

export function createUsage(o: UsageOptions): Usage {
  const platform = o.platform ?? process.platform;
  const ttl = o.homeTtlMs ?? 5 * 60_000;
  const deadline = o.homeDeadlineMs ?? 30_000;
  const clock = o.now ?? (() => performance.now());
  const cpuTimes = o.cpuTimes ?? cpuBusy;
  let last: Omit<HomeUsage, "measuring"> | undefined;
  let measuring: Promise<void> | undefined;
  let prevHost = cpuTimes();
  let prevCore = { cpu: process.cpuUsage(), at: clock() };
  let hostPct: number | undefined;
  let corePct: number | undefined;

  const home = (): HomeUsage => {
    const stale = !last?.measured_at || Date.now() - Date.parse(last.measured_at) > ttl;
    if (stale && !measuring)
      measuring = measureHome(o.home, deadline)
        .then((m) => {
          last = m;
        })
        .catch(() => undefined)
        .finally(() => {
          measuring = undefined;
        });
    return { measuring: measuring !== undefined, total_mb: 0, parts: [], ...last };
  };

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
        ...(disk ? { home: home() } : {}),
        ...(vm ? { vm } : {}),
      };
    },
  };
}
