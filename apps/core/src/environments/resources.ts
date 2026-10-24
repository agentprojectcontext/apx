import os from "node:os";

const GIB = 1024 ** 3;

export type ComputerResources = { memory_gib: number; cpus: number; disk_gib: number };
export type Range = { min: number; max: number };
export type ResourceLimits = { memory_gib: Range; cpus: Range; disk_gib: Range };
export type Host = { memoryBytes: number; cpus: number };

/** Free host memory a start must leave beside the VM's own, so the Mac keeps working. */
export const START_RESERVE_GIB = 2;
/** Below this much free host memory the watchdog stops a running VM (lower than the start reserve, so it never flaps). */
export const STOP_BELOW_GIB = 1;
/** Free disk a new guest disk must leave on its volume. */
export const DISK_RESERVE_GIB = 2;
export const DEFAULT_IDLE_MINUTES = 30;

export const thisHost = (): Host => ({ memoryBytes: os.totalmem(), cpus: os.availableParallelism() });

/** The guest keeps 2 GiB for its desktop and browser; the host keeps at least 4 GiB and half its cores. */
export function resourceLimits(host: Host): ResourceLimits {
  const totalGib = Math.floor(host.memoryBytes / GIB);
  return {
    memory_gib: { min: 2, max: Math.max(2, Math.min(32, totalGib - 4)) },
    cpus: { min: 1, max: Math.max(1, Math.min(8, Math.floor(host.cpus / 2))) },
    disk_gib: { min: 16, max: 256 },
  };
}

/** 4 GiB on a small Mac, more when it has plenty: a quarter of its memory up to 8 GiB. */
export function defaultResources(host: Host): ComputerResources {
  const limits = resourceLimits(host);
  const memory = Math.max(4, Math.min(8, Math.floor(host.memoryBytes / GIB / 4)));
  return {
    memory_gib: clamp(memory, limits.memory_gib),
    cpus: clamp(host.cpus >= 10 ? 4 : 2, limits.cpus),
    disk_gib: 24,
  };
}

const clamp = (value: number, range: Range) => Math.min(range.max, Math.max(range.min, Math.round(value)));

/** The owner's values where set, each held to this host's limits; the default for the rest. */
export function resolveResources(stored: Partial<ComputerResources>, host: Host): ComputerResources {
  const limits = resourceLimits(host);
  const base = defaultResources(host);
  return {
    memory_gib: clamp(stored.memory_gib ?? base.memory_gib, limits.memory_gib),
    cpus: clamp(stored.cpus ?? base.cpus, limits.cpus),
    disk_gib: clamp(stored.disk_gib ?? base.disk_gib, limits.disk_gib),
  };
}

/** Why the VM may not start now, or undefined: free memory must cover its memory plus the reserve. */
export function startRefusal(resources: ComputerResources, availableBytes: number): string | undefined {
  const needed = (resources.memory_gib + START_RESERVE_GIB) * GIB;
  if (availableBytes >= needed) return undefined;
  return `not enough free memory on this computer: ${gib(availableBytes)} GiB free, the VM needs ${resources.memory_gib} GiB plus ${START_RESERVE_GIB} GiB kept for the host. Close apps or lower the VM's memory, then try again`;
}

export const gib = (bytes: number) => (Math.floor((bytes / GIB) * 10) / 10).toString();

/** cpus, memory and disk as an instance's lima.yaml holds them ("4GiB", "24GiB"). */
export function configuredResources(yaml: string): Partial<ComputerResources> {
  const read = (key: string) => {
    const value = new RegExp(`^${key}:\\s*"?([0-9.]+)\\s*(GiB|MiB)?"?\\s*$`, "m").exec(yaml);
    if (!value) return undefined;
    const n = Number(value[1]);
    return value[2] === "MiB" ? n / 1024 : n;
  };
  const cpus = read("cpus");
  const memory = read("memory");
  const disk = read("disk");
  return {
    ...(cpus !== undefined ? { cpus } : {}),
    ...(memory !== undefined ? { memory_gib: memory } : {}),
    ...(disk !== undefined ? { disk_gib: disk } : {}),
  };
}

/** `limactl edit` flags for what differs; a disk only grows (Lima cannot shrink one). Empty when nothing changes. */
export function limaEditArgs(current: Partial<ComputerResources>, wanted: ComputerResources): string[] {
  return [
    ...(current.cpus !== wanted.cpus ? [`--cpus=${wanted.cpus}`] : []),
    ...(current.memory_gib !== wanted.memory_gib ? [`--memory=${wanted.memory_gib}`] : []),
    ...(current.disk_gib === undefined || current.disk_gib < wanted.disk_gib ? [`--disk=${wanted.disk_gib}`] : []),
  ];
}

/** `limactl start` flags for a new instance, over the template's own values. */
export const limaCreateArgs = (wanted: ComputerResources) => [
  `--cpus=${wanted.cpus}`,
  `--memory=${wanted.memory_gib}`,
  `--disk=${wanted.disk_gib}`,
];
