// What the computer has and what APX takes of it: memory, CPU, disk, the APX home by part, and the Linux VM when
// there is one. Read-only; the home's sizes are measured in the background and kept a while (a walk is slow).
import { z } from "zod";

export const DiskSpace = z.object({
  /** "home": the volume holding the APX home; "system": the system's. One volume can be both. */
  roles: z.array(z.enum(["home", "system"])),
  path: z.string(),
  total_mb: z.number(),
  free_mb: z.number(),
});
export type DiskSpace = z.infer<typeof DiskSpace>;

/** Parts of the APX home, each a set of its top-level folders and files. */
export const HOME_PARTS = ["databases", "logs", "models", "files", "browser", "projects", "computer", "other"] as const;
export const HomePart = z.enum(HOME_PARTS);
export type HomePart = z.infer<typeof HomePart>;

export const HomeUsage = z.object({
  /** Being measured now: `parts` are from the last measure, or empty before the first. */
  measuring: z.boolean(),
  measured_at: z.string().optional(),
  /** The walk ran past its deadline: the sizes are at least this much. */
  partial: z.boolean().optional(),
  total_mb: z.number(),
  parts: z.array(z.object({ id: HomePart, mb: z.number() })),
});
export type HomeUsage = z.infer<typeof HomeUsage>;

/** The Linux VM APX runs agents in, when there is one. */
export const VmUsage = z.object({
  running: z.boolean(),
  name: z.string().optional(),
  cpus: z.number().optional(),
  memory_assigned_mb: z.number().optional(),
  memory_used_mb: z.number().optional(),
  disk_mb: z.number().optional(),
});
export type VmUsage = z.infer<typeof VmUsage>;

export const SystemUsage = z.object({
  at: z.string(),
  host: z.object({
    platform: z.string(),
    memory_total_mb: z.number(),
    /** What apps can still take without the system swapping (macOS: what Activity Monitor counts as not used). */
    memory_available_mb: z.number(),
    cpus: z.number(),
    /** 1, 5 and 15 minute load averages (zeros on Windows). */
    load: z.array(z.number()),
    /** Busy share of all CPUs since the previous read, 0–100. Absent on the first read. */
    cpu_pct: z.number().optional(),
    disks: z.array(DiskSpace),
  }),
  core: z.object({
    pid: z.number(),
    rss_mb: z.number(),
    heap_mb: z.number(),
    /** The core's share of one CPU since the previous read (can pass 100 on several threads). */
    cpu_pct: z.number().optional(),
  }),
  /** Present only when asked (`disk: true`). */
  home: HomeUsage.optional(),
  vm: VmUsage.optional(),
});
export type SystemUsage = z.infer<typeof SystemUsage>;

export const usageMethods = {
  /** Memory, CPU and disk of the computer, and what the core takes; `disk` adds the APX home's size by part. */
  "system.usage": {
    params: z.object({ disk: z.boolean().default(false) }).strict(),
    result: SystemUsage,
    effect: false,
  },
} as const;
