// What APX keeps on disk by area, what it can clear because it rebuilds it (caches, rotated and old logs), and
// whether the disk holding the home is running out. The walk is bounded (entries and time) and never follows a link.
// See DECISIONS.md#d-185
import fs from "node:fs";
import path from "node:path";
import type { DiskStatus, HomeUsage, StorageArea, StorageUsage } from "@apx/protocol";
import type { BackgroundCheck } from "./engine/background.ts";
import { insideReal, isInside, samePath } from "./paths.ts";

const MB = 1048576;
const GB = 1024 * MB;
const DAY = 86_400_000;

/** Under this much free space the panel warns. */
export const LOW_DISK_BYTES = 5 * GB;

/** Top-level folders by area; files ending in a database suffix are the owner's data wherever they are. */
const AREA_OF: Record<string, StorageArea> = {
  media: "data",
  artifacts: "data",
  "artifact-sources": "data",
  projects: "projects",
  work: "projects",
  skills: "projects",
  extensions: "projects",
  "extension-data": "projects",
  computer: "computers",
  labs: "computers",
  browser: "browser",
  models: "models",
  logs: "logs",
  jobs: "logs",
  "codex-images": "caches",
  backups: "backups",
};
/** Folders inside the media folder that APX makes again when needed (a video's poster, a copy opened in an app). */
const MEDIA_CACHES = ["posters", "open"];
const DATABASE = /\.(db|sqlite)(-wal|-shm|-journal)?$/;

/** The area of a path relative to the home, written with `/`. */
export function areaOf(rel: string): StorageArea {
  const [top = "", sub] = rel.split("/");
  if (top === "media" && sub !== undefined && MEDIA_CACHES.includes(sub)) return "caches";
  return AREA_OF[top] ?? (top === rel && DATABASE.test(top) ? "data" : "other");
}

/**
 * Whether clearing may remove this file: only what APX makes again by itself. Posters any time; a copy opened in an
 * app and image work after a day (it may still be open); rotated logs any time, other logs after 14 days but never
 * the live one; a command's output after 30 days.
 */
export function clearable(rel: string, mtimeMs: number, now: number): boolean {
  const parts = rel.split("/");
  const age = now - mtimeMs;
  const [top, sub] = parts;
  if (top === "media" && sub === "posters" && parts.length > 2) return true;
  if ((top === "media" && sub === "open" && parts.length > 2) || (top === "codex-images" && parts.length > 1))
    return age > DAY;
  if (parts.length === 2 && parts[0] === "logs") {
    const name = parts[1] ?? "";
    if (name === "core.log") return false;
    return /\.\d+$/.test(name) || age > 14 * DAY;
  }
  if (parts.length === 2 && parts[0] === "jobs") return /\.log$/.test(parts[1] ?? "") && age > 30 * DAY;
  return false;
}
/** The folders clearing looks in: nothing outside them is ever read for removal. */
const CLEAR_ROOTS = ["media/posters", "media/open", "codex-images", "logs", "jobs"];

export type WalkLimits = {
  /** Entries read before the walk stops (marked partial). */
  maxEntries: number;
  /** How long it may walk, on `now`. */
  deadlineMs: number;
  now?: () => number;
};
const LIMITS: WalkLimits = { maxEntries: 400_000, deadlineMs: 30_000 };

type FileSeen = { rel: string; abs: string; bytes: number; mtimeMs: number };

/**
 * Every regular file under `root` (relative to `home`), with what it takes on disk (allocated blocks, so a sparse VM
 * image counts what it holds). Links are never followed or counted. Stops at the entry cap or the deadline.
 */
async function walk(
  home: string,
  roots: string[],
  limits: WalkLimits,
  seen: (f: FileSeen) => void,
): Promise<{ partial: boolean }> {
  const now = limits.now ?? Date.now;
  const until = now() + limits.deadlineMs;
  let entries = 0;
  const stack = [...roots];
  while (stack.length) {
    if (now() > until) return { partial: true };
    const rel = stack.pop() as string;
    const abs = rel ? path.join(home, ...rel.split("/")) : home;
    let list: fs.Dirent[];
    try {
      list = await fs.promises.readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries += list.length;
    if (entries > limits.maxEntries) return { partial: true };
    const files: { rel: string; abs: string }[] = [];
    for (const e of list) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(r);
      else if (e.isFile()) files.push({ rel: r, abs: path.join(abs, e.name) });
    }
    const stats = await Promise.all(files.map((f) => fs.promises.lstat(f.abs).catch(() => undefined)));
    stats.forEach((st, i) => {
      const f = files[i];
      if (!st?.isFile() || !f) return;
      seen({ ...f, bytes: st.blocks !== undefined && st.blocks > 0 ? st.blocks * 512 : st.size, mtimeMs: st.mtimeMs });
    });
  }
  return { partial: false };
}

export type Measure = Omit<StorageUsage, "measuring" | "disk">;

/** The home by area, and what clearing would free from each. */
export async function measureStorage(home: string, limits: WalkLimits = LIMITS): Promise<Measure> {
  const now = limits.now ?? Date.now;
  const at = now();
  const by = new Map<StorageArea, { bytes: number; freeable_bytes: number }>();
  const { partial } = await walk(home, [""], limits, (f) => {
    const a = areaOf(f.rel);
    const cur = by.get(a) ?? { bytes: 0, freeable_bytes: 0 };
    cur.bytes += f.bytes;
    if (clearable(f.rel, f.mtimeMs, at)) cur.freeable_bytes += f.bytes;
    by.set(a, cur);
  });
  const areas = [...by]
    .map(([id, v]) => ({ id, ...v }))
    .filter((a) => a.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  return {
    measured_at: new Date().toISOString(),
    ...(partial ? { partial } : {}),
    total_bytes: areas.reduce((n, a) => n + a.bytes, 0),
    freeable_bytes: areas.reduce((n, a) => n + a.freeable_bytes, 0),
    areas,
  };
}

/** Removes what `clearable` allows inside the clear folders, then their emptied subfolders. */
export async function clearStorage(
  home: string,
  limits: WalkLimits = LIMITS,
): Promise<{ freed_bytes: number; files: number }> {
  const now = (limits.now ?? Date.now)();
  // A clear folder that is a link, or resolves outside the home, is left alone.
  const roots = CLEAR_ROOTS.filter((r) => {
    try {
      return !fs.lstatSync(path.join(home, r)).isSymbolicLink() && insideReal(home, r);
    } catch {
      return false;
    }
  });
  const gone: FileSeen[] = [];
  await walk(home, roots, limits, (f) => {
    if (clearable(f.rel, f.mtimeMs, now)) gone.push(f);
  });
  let freed = 0;
  let files = 0;
  const dirs = new Set<string>();
  for (const f of gone) {
    try {
      fs.unlinkSync(f.abs);
      freed += f.bytes;
      files++;
      dirs.add(path.dirname(f.abs));
    } catch {}
  }
  // Deepest first; a clear folder itself stays.
  const keep = roots.map((r) => path.join(home, r));
  const below = (p: string) => keep.some((k) => isInside(k, p) && !samePath(k, p));
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    for (let cur = d; below(cur); cur = path.dirname(cur)) {
      try {
        fs.rmdirSync(cur);
      } catch {
        break;
      }
    }
  }
  return { freed_bytes: freed, files };
}

export const isLow = (freeBytes: number, threshold = LOW_DISK_BYTES) => freeBytes < threshold;

async function statDisk(p: string): Promise<{ free: number; total: number }> {
  const st = await fs.promises.statfs(p);
  return { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
}

export type StorageOptions = {
  home: string;
  /** How long a measure stays good. */
  ttlMs?: number;
  limits?: WalkLimits;
  threshold?: number;
  /** The disk's free and total bytes (tests pass one). */
  disk?: (home: string) => Promise<{ free: number; total: number }>;
  /** The low-disk state flipped, or space was freed. */
  onChange?: () => void;
};

export type Storage = ReturnType<typeof createStorage>;

export function createStorage(o: StorageOptions) {
  const ttl = o.ttlMs ?? 5 * 60_000;
  const limits = o.limits ?? LIMITS;
  const threshold = o.threshold ?? LOW_DISK_BYTES;
  const readDisk = o.disk ?? statDisk;
  let last: Measure | undefined;
  let measuring: Promise<void> | undefined;
  let low: boolean | undefined;

  const start = () => {
    measuring ??= measureStorage(o.home, limits)
      .then((m) => {
        last = m;
      })
      .catch(() => undefined)
      .finally(() => {
        measuring = undefined;
      });
    return measuring;
  };
  /** The last measure, starting the next one when it is stale; never waits for the walk. */
  const current = (refresh = false) => {
    const stale = !last?.measured_at || Date.now() - Date.parse(last.measured_at) > ttl;
    if (refresh || stale) void start();
    return { measuring: measuring !== undefined, ...(last ?? { total_bytes: 0, freeable_bytes: 0, areas: [] }) };
  };

  async function disk(): Promise<DiskStatus> {
    const d = await readDisk(o.home);
    return { free_bytes: d.free, total_bytes: d.total, low: isLow(d.free, threshold), threshold_bytes: threshold };
  }

  return {
    async usage({ refresh }: { refresh: boolean }): Promise<StorageUsage> {
      const now = current(refresh);
      const d = await disk().catch(() => undefined);
      return { ...now, ...(d ? { disk: d } : {}) };
    },
    disk,
    /** The same measure in MB by part, for system.usage. */
    home(): HomeUsage {
      const m = current();
      return {
        measuring: m.measuring,
        ...(m.measured_at ? { measured_at: m.measured_at } : {}),
        ...(m.partial ? { partial: m.partial } : {}),
        total_mb: Math.round(m.total_bytes / MB),
        parts: m.areas.map((a) => ({ id: a.id, mb: Math.round(a.bytes / MB) })).filter((p) => p.mb > 0),
      };
    },
    async clear(): Promise<{ freed_bytes: number; files: number }> {
      const r = await clearStorage(o.home, limits);
      last = undefined;
      void start();
      o.onChange?.();
      return r;
    },
    /** Waits for a walk in progress (tests, and a clear right after one). */
    settled: () => measuring ?? Promise.resolve(),
    /** Looks at the disk on the office clock; the panel hears only when low flips. */
    check: {
      id: "storage-disk",
      everyMs: 10 * 60_000,
      run: async (_at: Date) => {
        const now = (await disk()).low;
        if (now === low) return;
        const told = low !== undefined || now;
        low = now;
        if (told) o.onChange?.();
      },
    } satisfies BackgroundCheck,
  };
}
