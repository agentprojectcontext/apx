// The Codex app's own index (~/.codex/state_<n>.sqlite): its projects and the threads in each, with the names the owner
// sees there. Opened read-only; a Codex without it (the bare CLI) is read from its session files instead.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type CodexProject = { id: string; name: string; roots: string[] };
export type CodexThread = {
  id: string;
  title: string;
  cwd: string;
  /** The rollout file as the index names it (it may be compressed on disk). */
  file: string;
  updated_at: string;
  project_id?: string | undefined;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : 0);

/** The newest state database Codex keeps (state_5.sqlite today). */
function stateFile(home: string): string | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(home);
  } catch {
    return undefined;
  }
  const found = names
    .map((n) => ({ n, v: Number(/^state_(\d+)\.sqlite$/.exec(n)?.[1] ?? Number.NaN) }))
    .filter((x) => Number.isFinite(x.v))
    .sort((a, b) => b.v - a.v)[0];
  return found ? path.join(home, found.n) : undefined;
}

/** A thread's first line, as Codex shows an unnamed one. */
const firstLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);

/**
 * Codex's projects and the owner's own threads (not archived, not a sub-agent's, not APX's runs through the SDK), or
 * undefined when this Codex keeps no index.
 */
export function codexState(home: string): { projects: CodexProject[]; threads: CodexThread[] } | undefined {
  const file = stateFile(home);
  if (!file) return undefined;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch {
    return undefined;
  }
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => str(r.name)),
    );
    if (!tables.has("threads")) return undefined;
    const projects: CodexProject[] = [];
    if (tables.has("projects") && tables.has("project_roots")) {
      const roots = new Map<string, string[]>();
      for (const r of db.prepare("SELECT project_id, path FROM project_roots ORDER BY position").all())
        roots.set(str(r.project_id), [...(roots.get(str(r.project_id)) ?? []), str(r.path)]);
      for (const r of db.prepare("SELECT id, name FROM projects ORDER BY position").all())
        projects.push({ id: str(r.id), name: str(r.name), roots: roots.get(str(r.id)) ?? [] });
    }
    const threads: CodexThread[] = [];
    // Columns differ across Codex versions: read every one and take what is there.
    for (const r of db.prepare("SELECT * FROM threads").all()) {
      if (num(r.archived)) continue;
      if (str(r.thread_source) === "subagent" || str(r.originator) === "codex_sdk_ts" || str(r.agent_role)) continue;
      const id = str(r.id);
      const cwd = str(r.cwd);
      const title = str(r.name) || firstLine(str(r.title)) || firstLine(str(r.first_user_message));
      if (!id || !cwd || !str(r.rollout_path) || !title) continue;
      const ms = num(r.updated_at_ms) || num(r.updated_at) * 1000;
      threads.push({
        id,
        title,
        cwd,
        file: str(r.rollout_path),
        updated_at: new Date(ms || Date.now()).toISOString(),
        ...(str(r.project_id) ? { project_id: str(r.project_id) } : {}),
      });
    }
    threads.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { projects, threads };
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}
