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

/**
 * One of the agents' computers on this disk: the shared Lima VM APX manages (`agents`), or a test VM left under
 * `labs/` (`lab`). `id` is the core's own; a delete names it, never a path.
 */
export const StorageComputer = z.object({
  id: z.string(),
  kind: z.enum(["agents", "lab"]),
  /** The folder's name: shown for a lab only, the agents' computer is named by its kind. */
  name: z.string(),
  bytes: z.number(),
  /** On, starting or stopping: it cannot be deleted until it is off. */
  on: z.boolean(),
  /** `environments.stop` turns it off (the agents' computer while it runs). */
  can_turn_off: z.boolean().optional(),
  last_used_at: z.string().optional(),
});
export type StorageComputer = z.infer<typeof StorageComputer>;

/** A copy of the database kept in the backups folder (with its -wal/-shm beside it, counted in `bytes`). */
export const StorageBackup = z.object({
  id: z.string(),
  name: z.string(),
  bytes: z.number(),
  created_at: z.string(),
});
export type StorageBackup = z.infer<typeof StorageBackup>;

/** What compacting the chats' history did, and the database's size before and after. */
export const StoreCompaction = z.object({
  before_bytes: z.number(),
  after_bytes: z.number(),
  runs_trimmed: z.number(),
  runs_compacted: z.number(),
  outputs_dropped: z.number(),
  rows: z.number(),
  /** How the free space went back: bit by bit, a one-time rewrite, or not yet (too little free disk to rewrite). */
  reclaimed: z.enum(["incremental", "rebuilt", "not_enough_disk"]),
});
export type StoreCompaction = z.infer<typeof StoreCompaction>;

const ItemId = z.object({ id: z.string().min(1).max(200) }).strict();
const Freed = z.object({ freed_bytes: z.number() });

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
  /**
   * Trims what the chats' history keeps beyond what any model can still read (whole outputs it already holds, old
   * turns far behind every chat's view), then gives the free space back to the disk. `apx doctor --fix` calls it.
   */
  "storage.compact": {
    params: z.object({}).strict(),
    result: StoreCompaction,
    effect: true,
    access: "human",
  },
  /** The agents' computers on this disk, each with its size and whether it is on. */
  "storage.computers.list": {
    params: z.object({}).strict(),
    result: z.object({ computers: z.array(StorageComputer) }),
    effect: false,
  },
  /**
   * Deletes a computer the list named, with everything inside it; refused while it is on. The agents' computer is set
   * up again from scratch the next time an agent needs it.
   */
  "storage.computers.delete": {
    params: ItemId,
    result: Freed,
    effect: true,
    access: "human",
  },
  /** Copies of the database in the backups folder, newest first. */
  "storage.backups.list": {
    params: z.object({}).strict(),
    result: z.object({ backups: z.array(StorageBackup) }),
    effect: false,
  },
  /** Deletes a backup copy the list named. */
  "storage.backups.delete": {
    params: ItemId,
    result: Freed,
    effect: true,
    access: "human",
  },
} as const;
