// What APX keeps on disk, by area the owner knows, and clearing what it can rebuild (caches, old logs). The home's
// sizes come from a bounded walk in the background; the disk's free space is read on each call. See
// DECISIONS.md#d-185
import { z } from "zod";

/** Areas of the APX home, each a set of its folders and files (apps/core/src/storage.ts says which). */
export const STORAGE_AREAS = [
  "data",
  "projects",
  "computers",
  "browser",
  "models",
  "logs",
  "caches",
  "backups",
  "other",
] as const;
export const StorageArea = z.enum(STORAGE_AREAS);
export type StorageArea = z.infer<typeof StorageArea>;

/** The volume holding the APX home, and whether it is running out. */
export const DiskStatus = z.object({
  free_bytes: z.number(),
  total_bytes: z.number(),
  /** Free space is under `threshold_bytes`: the panel says so until there is room again. */
  low: z.boolean(),
  threshold_bytes: z.number(),
});
export type DiskStatus = z.infer<typeof DiskStatus>;

export const StorageUsage = z.object({
  /** Being measured now: `areas` are from the last measure, or empty before the first. */
  measuring: z.boolean(),
  measured_at: z.string().optional(),
  /** The walk stopped at its cap (entries or time): the sizes are at least this much. */
  partial: z.boolean().optional(),
  total_bytes: z.number(),
  /** Biggest first; `freeable_bytes` is what clearing would remove from it. */
  areas: z.array(z.object({ id: StorageArea, bytes: z.number(), freeable_bytes: z.number() })),
  /** What `storage.clear` frees now, as last measured. */
  freeable_bytes: z.number(),
  disk: DiskStatus.optional(),
});
export type StorageUsage = z.infer<typeof StorageUsage>;

export const storageMethods = {
  /** The APX home by area and what clearing would free; `refresh` measures again now. */
  "storage.usage": {
    params: z.object({ refresh: z.boolean().default(false) }).strict(),
    result: StorageUsage,
    effect: false,
  },
  /** Free space on the disk holding the APX home: cheap, for the low-disk warning. */
  "storage.status": {
    params: z.object({}).strict(),
    result: DiskStatus,
    effect: false,
  },
  /** Removes only what APX rebuilds on its own (caches, rotated and old logs); never chats, memory or projects. */
  "storage.clear": {
    params: z.object({}).strict(),
    result: z.object({ freed_bytes: z.number(), files: z.number() }),
    effect: true,
    access: "human",
  },
} as const;
