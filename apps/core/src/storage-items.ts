// The big things in Storage the owner deletes one by one: the agents' computers (the shared Lima VM, and test VMs
// left under labs/) and the backup copies of the database. A delete names an id this module listed, never a path,
// and is refused while a computer is on. See DECISIONS.md#d-185
import fs from "node:fs";
import path from "node:path";
import type { StorageBackup, StorageComputer } from "@apx/protocol";
import { conflict, notFound } from "./errors.ts";
import { insideReal, isInside } from "./paths.ts";
import { sizeOf, type WalkLimits } from "./storage.ts";

/** The VM APX manages, as the computer's own code sees it (environments/managed.ts). */
export type ManagedComputer = {
  limaHome: string;
  instance: string;
  /** Its lifecycle phase: running, preparing and stopping count as on. */
  phase(): Promise<string | undefined>;
  /** Its own teardown (Lima's delete), refused while it runs. */
  remove(): Promise<void>;
  /** When the owner, an agent or the idle watchdog last turned it off. */
  lastStop?(): string | undefined;
};

export type StorageItemsOptions = {
  home: string;
  computer?: ManagedComputer;
  /** Space was freed: the measure starts again and the panel hears. */
  changed?: () => void;
  limits?: WalkLimits;
  /** Whether a process lives (a lab VM's host agent); tests pass one. */
  alive?: (pid: number) => boolean;
};

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;
const ON = new Set(["running", "preparing", "stopping"]);
/** A copy of the database: the copy itself, and SQLite's files beside it that belong to it. */
const BACKUP = /^[^/\\]+\.(db|sqlite|sqlite3|bak)$/i;
const COMPANIONS = ["-wal", "-shm", "-journal"];
const LIMITS: WalkLimits = { maxEntries: 200_000, deadlineMs: 15_000 };

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const dirs = (abs: string): string[] => {
  try {
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && NAME.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
};

/** The newest change among a folder's own files: when its VM last wrote its logs or disk. */
function lastWrite(abs: string): string | undefined {
  let newest = 0;
  try {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }))
      if (e.isFile()) newest = Math.max(newest, fs.lstatSync(path.join(abs, e.name)).mtimeMs);
  } catch {}
  return newest ? new Date(newest).toISOString() : undefined;
}

type Found = StorageComputer & { rel: string };

export function createStorageItems(o: StorageItemsOptions) {
  const limits = o.limits ?? LIMITS;
  const alive = o.alive ?? processAlive;
  const managed = o.computer && isInside(o.home, o.computer.limaHome) ? o.computer : undefined;
  const rel = (abs: string) => path.relative(o.home, abs).split(path.sep).join("/");

  /** A lab is on while one of its Lima instances has a live host agent (its ha.pid). */
  const labOn = (lab: string) =>
    dirs(path.join(lab, "lima")).some((i) => {
      try {
        const pid = Number(fs.readFileSync(path.join(lab, "lima", i, "ha.pid"), "utf8").trim());
        return pid > 0 && alive(pid);
      } catch {
        return false;
      }
    });

  async function computers(): Promise<Found[]> {
    const out: Found[] = [];
    if (managed) {
      const dir = path.join(managed.limaHome, managed.instance);
      if (fs.existsSync(dir) && insideReal(o.home, rel(dir))) {
        const phase = await managed.phase().catch(() => undefined);
        const on = phase !== undefined && ON.has(phase);
        let stopped: string | undefined;
        try {
          stopped = (JSON.parse(managed.lastStop?.() ?? "null") as { at?: string } | null)?.at;
        } catch {}
        const used = on ? undefined : (stopped ?? lastWrite(dir));
        out.push({
          id: `agents:${managed.instance}`,
          kind: "agents",
          name: managed.instance,
          rel: rel(dir),
          bytes: await sizeOf(o.home, rel(dir), limits),
          on,
          ...(phase === "running" ? { can_turn_off: true } : {}),
          ...(used ? { last_used_at: used } : {}),
        });
      }
    }
    const labs = path.join(o.home, "labs");
    for (const name of dirs(labs)) {
      const abs = path.join(labs, name);
      if (!insideReal(o.home, rel(abs)) || fs.lstatSync(abs).isSymbolicLink()) continue;
      const used = dirs(path.join(abs, "lima"))
        .map((i) => lastWrite(path.join(abs, "lima", i)))
        .filter((d): d is string => d !== undefined)
        .sort()
        .at(-1);
      out.push({
        id: `lab:${name}`,
        kind: "lab",
        name,
        rel: rel(abs),
        bytes: await sizeOf(o.home, rel(abs), limits),
        on: labOn(abs),
        ...(used ? { last_used_at: used } : {}),
      });
    }
    return out.sort((a, b) => b.bytes - a.bytes);
  }

  type Copy = StorageBackup & { files: string[] };
  function backups(): Copy[] {
    const dir = path.join(o.home, "backups");
    if (!insideReal(o.home, "backups")) return [];
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out: Copy[] = [];
    for (const name of names) {
      if (!BACKUP.test(name)) continue;
      const abs = path.join(dir, name);
      const st = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (!st?.isFile()) continue;
      const files = [abs];
      let bytes = st.size;
      for (const suffix of COMPANIONS) {
        const c = fs.lstatSync(`${abs}${suffix}`, { throwIfNoEntry: false });
        if (c?.isFile()) {
          files.push(`${abs}${suffix}`);
          bytes += c.size;
        }
      }
      out.push({ id: name, name, bytes, created_at: new Date(st.mtimeMs).toISOString(), files });
    }
    return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  return {
    async listComputers(): Promise<StorageComputer[]> {
      return (await computers()).map(({ rel: _rel, ...c }) => c);
    },
    async deleteComputer(id: string): Promise<{ freed_bytes: number }> {
      const c = (await computers()).find((x) => x.id === id);
      if (!c) throw notFound("computer");
      if (c.on) throw conflict("the computer is on; turn it off first");
      const abs = path.join(o.home, ...c.rel.split("/"));
      if (!isInside(o.home, abs) || !insideReal(o.home, c.rel)) throw notFound("computer");
      if (c.kind === "agents" && managed) await managed.remove();
      else {
        // A lab's VM has no core of its own to ask: looked at again right before it goes.
        if (labOn(abs)) throw conflict("the computer is on; turn it off first");
        await fs.promises.rm(abs, { recursive: true, force: true });
      }
      o.changed?.();
      return { freed_bytes: c.bytes };
    },
    listBackups(): StorageBackup[] {
      return backups().map(({ files: _files, ...b }) => b);
    },
    deleteBackup(id: string): { freed_bytes: number } {
      const b = backups().find((x) => x.id === id);
      if (!b) throw notFound("backup");
      const dir = path.join(o.home, "backups");
      for (const f of b.files) if (isInside(dir, f)) fs.rmSync(f, { force: true });
      o.changed?.();
      return { freed_bytes: b.bytes };
    },
  };
}

export type StorageItems = ReturnType<typeof createStorageItems>;
