// Memory: short notes agents keep between threads, scoped to the owner (global), a project or one agent, searched
// with SQLite's full-text index.
import type { Memory, MemoryScope } from "@apx/protocol";
import { newId, now, opt, type Row, type Sql } from "./sql.ts";

const toMemory = (r: Row): Memory => ({
  id: String(r.id),
  scope: r.scope as MemoryScope,
  ...opt("project_id", r.project_id),
  ...opt("agent_id", r.agent_id),
  text: String(r.text),
  source: r.source === "owner" ? "owner" : "agent",
  ...opt("author_agent", r.author_agent),
  ...opt("thread_id", r.thread_id),
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
});

/** What one agent in one thread may see: the owner's notes, the thread's project's and its own. */
export type MemoryView = { agent_id: string; project_id?: string | undefined };

export const canSee = (v: MemoryView, m: Memory) =>
  m.scope === "global" ||
  (m.scope === "project" && !!v.project_id && m.project_id === v.project_id) ||
  (m.scope === "agent" && m.agent_id === v.agent_id);

const STOP = new Set(
  (
    "the and for are but not you all any can had her was one our out has have this that with what when where which " +
    "who will would there their they them then than from into about your just like also more some such only over " +
    "que los las del por con para una uno unos unas como pero sus esta este esto estos estas ese esa eso hay muy " +
    "sin sobre entre cuando donde quien cual todo toda todos todas tambien porque mas ya fue ser son era han hace " +
    "tengo tenes tiene tenemos vos yo mi mis tu tus le les lo al se si no es el la de en un y o a"
  ).split(" "),
);

/**
 * Turns free text into a safe FTS5 query: its distinctive words, each quoted (no operators get through), any of
 * them matching, longer words also by prefix (plural, gender).
 */
export function ftsQuery(text: string, max = 16): string | undefined {
  const words = [
    ...new Set(
      (
        text
          .normalize("NFD")
          .replace(/\p{M}/gu, "")
          .toLowerCase()
          .match(/[\p{L}\p{N}]{3,}/gu) ?? []
      ).filter((w) => !STOP.has(w)),
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .slice(0, max);
  if (!words.length) return undefined;
  return words.map((w) => (w.length >= 5 ? `"${w}"*` : `"${w}"`)).join(" OR ");
}

const SECRET_SHAPES = [
  /\b(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/,
  /\b(ghp|gho|ghs|github_pat|xox[abprs]|glpat|AKIA)[-_A-Za-z0-9]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])[A-Za-z0-9+/_-]{32,}\b/,
  /\b(password|passwd|contraseña|clave|pin|2fa|otp)\s*[:=]\s*\S+/i,
];

/** A note must never hold a credential: memory goes into prompts. */
export const looksSecret = (text: string) => SECRET_SHAPES.some((re) => re.test(text));

export function memoriesRepo({ one, all, run }: Sql) {
  const visible = (v: MemoryView | undefined): { where: string; args: unknown[] } =>
    v
      ? {
          where: "(scope = 'global' OR (scope = 'project' AND project_id = ?) OR (scope = 'agent' AND agent_id = ?))",
          args: [v.project_id ?? "", v.agent_id],
        }
      : { where: "1 = 1", args: [] };

  const repo = {
    get(id: string): Memory | undefined {
      const r = one("SELECT * FROM memories WHERE id = ?", id);
      return r ? toMemory(r) : undefined;
    },
    /** Adds a note; the same text already in the same place is returned instead of a copy. */
    add(m: {
      scope: MemoryScope;
      project_id?: string | undefined;
      agent_id?: string | undefined;
      text: string;
      source: "owner" | "agent";
      author_agent?: string | undefined;
      thread_id?: string | undefined;
    }): Memory {
      const same = one(
        "SELECT id FROM memories WHERE scope = ? AND IFNULL(project_id, '') = ? AND IFNULL(agent_id, '') = ? AND lower(trim(text)) = lower(trim(?))",
        m.scope,
        m.project_id ?? "",
        m.agent_id ?? "",
        m.text,
      );
      if (same) return repo.get(String(same.id)) as Memory;
      const id = newId("mem");
      const at = now();
      run(
        "INSERT INTO memories (id, scope, project_id, agent_id, text, source, author_agent, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        m.scope,
        m.project_id ?? null,
        m.agent_id ?? null,
        m.text,
        m.source,
        m.author_agent ?? null,
        m.thread_id ?? null,
        at,
        at,
      );
      return repo.get(id) as Memory;
    },
    edit(id: string, text: string): Memory | undefined {
      run("UPDATE memories SET text = ?, updated_at = ? WHERE id = ?", text, now(), id);
      return repo.get(id);
    },
    remove(id: string): boolean {
      return Number(run("DELETE FROM memories WHERE id = ?", id).changes) > 0;
    },
    /** Newest first, or with `query` the best full-text matches first. */
    list(o: {
      view?: MemoryView | undefined;
      scope?: MemoryScope | undefined;
      project_id?: string | undefined;
      agent_id?: string | undefined;
      query?: string | undefined;
      exclude?: string[] | undefined;
      limit: number;
    }): Memory[] {
      const v = visible(o.view);
      const where = [v.where];
      const args: unknown[] = [...v.args];
      for (const [col, value] of [
        ["scope", o.scope],
        ["project_id", o.project_id],
        ["agent_id", o.agent_id],
      ] as const)
        if (value) {
          where.push(`m.${col} = ?`);
          args.push(value);
        }
      if (o.exclude?.length) {
        where.push(`m.id NOT IN (${o.exclude.map(() => "?").join(", ")})`);
        args.push(...o.exclude);
      }
      const match = o.query ? ftsQuery(o.query) : undefined;
      if (o.query && !match) return [];
      const rows = match
        ? all(
            `SELECT m.* FROM memories_fts f JOIN memories m ON m.n = f.rowid WHERE memories_fts MATCH ? AND ${where.join(" AND ")} ORDER BY bm25(memories_fts) LIMIT ?`,
            match,
            ...args,
            o.limit,
          )
        : all(
            `SELECT m.* FROM memories m WHERE ${where.join(" AND ")} ORDER BY m.updated_at DESC LIMIT ?`,
            ...args,
            o.limit,
          );
      return rows.map(toMemory);
    },
  };
  return repo;
}

export type Memories = ReturnType<typeof memoriesRepo>;
