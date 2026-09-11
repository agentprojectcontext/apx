// The throwaway project an e2e run works on: where its coordinates live, and how
// to take it back out again afterwards.
//
// Never remove it by id alone. ProjectManager (src/host/daemon/db.js) is an
// in-memory registry: ids are handed out by insertion order on every daemon
// boot, and unregister() only drops the entry from memory — config.json is left
// untouched. So a teardown that outlives a daemon restart, or that runs off a
// stale .runtime.json, would DELETE whichever real project inherited the number.
// Everything below resolves by PATH; the recorded id is only a hint for the
// warning we print when the two disagree.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUNTIME_FILE = path.join(HERE, ".runtime.json");

// Every throwaway lives in a mkdtemp dir carrying this marker. Nothing is
// removed — from the daemon, from disk, or from the global config — unless its
// path carries it too.
const MARKER = "apx-e2e-";

export interface Runtime {
  token: string;
  daemon: string;
  projectId: number;
  projectPath: string;
  tmpDir: string;
  startedAt: string;
}

export function readRuntime(): Runtime | null {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8")) as Runtime;
  } catch {
    return null;
  }
}

export function clearRuntime() {
  try {
    fs.rmSync(RUNTIME_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

/** The throwaway's absolute path, or null if the record doesn't describe one. */
export function throwawayPath(rt: Runtime): string | null {
  const raw = rt.projectPath || rt.tmpDir || "";
  const abs = raw ? path.resolve(raw) : "";
  return abs.includes(MARKER) ? abs : null;
}

function warn(msg: string) {
  // eslint-disable-next-line no-console
  console.warn(`[e2e] ${msg}`);
}

/**
 * Unregister the throwaway, drop its temp dir, and take its path back out of the
 * global config. Best-effort throughout: teardown failures must never mask test
 * failures.
 */
export async function dropThrowaway(rt: Runtime) {
  const want = throwawayPath(rt);
  if (!want) {
    warn(`refusing to clean up: .runtime.json points at "${rt.projectPath || rt.tmpDir}", which is not a ${MARKER}* path`);
    return;
  }

  // 1. Unregister — by path, and only if the daemon still has it.
  let listed: Array<{ id: number; path: string }> = [];
  try {
    const res = await fetch(`${rt.daemon}/api/projects`, {
      headers: { authorization: `Bearer ${rt.token}` },
    });
    if (res.ok) listed = (await res.json()) as typeof listed;
  } catch {
    /* daemon down — nothing is registered to clean up */
  }
  const entry = listed.find((p) => path.resolve(p.path) === want);
  if (entry) {
    if (Number(entry.id) !== Number(rt.projectId)) {
      warn(`throwaway moved from #${rt.projectId} to #${entry.id} (daemon restarted?) — removing #${entry.id}, the one that matches ${want}`);
    }
    try {
      await fetch(`${rt.daemon}/api/projects/${entry.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${rt.token}` },
      });
    } catch {
      /* ignore */
    }
  } else {
    const holder = listed.find((p) => Number(p.id) === Number(rt.projectId));
    if (holder) {
      warn(`NOT deleting #${rt.projectId}: it is now "${holder.path}", not the throwaway ${want}`);
    }
  }

  // 2. The temp dir itself.
  try {
    if (rt.tmpDir && rt.tmpDir.includes(MARKER)) {
      fs.rmSync(rt.tmpDir, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }

  // 3. The global config. Registering went through the daemon, which persists
  //    the path to ~/.apx/config.json. The DELETE above now takes it out again
  //    (api/projects.js), so this is a BACKSTOP for the runs that never reach
  //    that call — a suite killed mid-flight, or a daemon that died first. It
  //    was the only cleanup for a long time, and the ~20 dead
  //    /var/folders/**/apx-e2e-* entries left in one config are what those runs
  //    looked like. We remove only our own path, through the config module's
  //    own writer; removing a path that is already gone is a no-op.
  try {
    const cfgMod = await import("../../../core/config/index.js");
    const cfg = cfgMod.readConfig();
    cfgMod.removeProject(cfg, want);
  } catch (e) {
    warn(`could not take ${want} out of the global config: ${(e as Error)?.message || e}`);
  }
}
