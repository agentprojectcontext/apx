import fs from "node:fs";
import path from "node:path";
import type { ComputerResources } from "./resources.ts";

/** The VM's own numbers for a resource monitor: what it was given, what its guest uses, what its disk holds. */
export type ComputerUsage = {
  running: boolean;
  name?: string;
  cpus?: number;
  memory_assigned_mb?: number;
  memory_used_mb?: number;
  disk_mb?: number;
};

const MIB = 1024 ** 2;

/**
 * Bytes the guest disk holds in an instance folder: allocated blocks, since it is sparse and grows up to its size.
 * Lima 2 names it `disk`; older instances, `diffdisk`. 0 before it exists.
 */
export function diskImageBytes(instanceDir: string): number {
  for (const name of ["disk", "diffdisk"])
    try {
      return fs.statSync(path.join(instanceDir, name)).blocks * 512;
    } catch {}
  return 0;
}

/** Used memory as the guest counts it (total minus available); undefined when its meminfo cannot be read. */
export function usedFromMeminfo(text: string): number | undefined {
  const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(text)?.[1] ?? Number.NaN);
  const used = kb("MemTotal") - kb("MemAvailable");
  return Number.isFinite(used) ? Math.round(used / 1024) : undefined;
}

/** Never throws: a guest that does not answer leaves its used memory out, the rest still reads. */
export async function computerUsage(o: {
  name: string;
  running: () => Promise<boolean>;
  assigned: () => Partial<ComputerResources>;
  imageBytes: () => number;
  meminfo: () => Promise<string>;
}): Promise<ComputerUsage> {
  const running = await o.running().catch(() => false);
  const assigned = o.assigned();
  const used = running ? await o.meminfo().then(usedFromMeminfo, () => undefined) : undefined;
  const disk = o.imageBytes();
  return {
    running,
    name: o.name,
    ...(assigned.cpus !== undefined ? { cpus: assigned.cpus } : {}),
    ...(assigned.memory_gib !== undefined ? { memory_assigned_mb: Math.round(assigned.memory_gib * 1024) } : {}),
    ...(used !== undefined ? { memory_used_mb: used } : {}),
    ...(disk ? { disk_mb: Math.round(disk / MIB) } : {}),
  };
}
