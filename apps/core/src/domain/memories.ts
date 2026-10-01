// Memory: short notes agents keep between threads, scoped to the owner (global), a project or one agent, searched
// with SQLite's full-text index.
import type { Memory, MemoryScope } from "@apx/protocol";
import { type ExpressionBuilder, sql as raw, type Selectable } from "kysely";
import type { Database, MemoriesTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

const toMemory = (r: Selectable<MemoriesTable>): Memory => ({
  id: r.id,
  scope: r.scope as MemoryScope,
  ...opt("project_id", r.project_id),
  ...opt("agent_id", r.agent_id),
  text: r.text,
  source: r.source === "owner" ? "owner" : "agent",
  ...opt("author_agent", r.author_agent),
  ...opt("thread_id", r.thread_id),
  tainted: Boolean(r.tainted),
  created_at: r.created_at,
  updated_at: r.updated_at,
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
  // One unbroken run of mixed case and digits (keys, tokens); paths and slugs are broken by "/" and "-".
  /(?<![\w/-])(?=[A-Za-z0-9_+=]*\d)(?=[A-Za-z0-9_+=]*[a-z])(?=[A-Za-z0-9_+=]*[A-Z])[A-Za-z0-9_+=]{32,}(?![\w/-])/,
  // A credential label followed by a value that has a digit or symbol in it.
  /\b(password|passwd|contraseña|clave|pin|2fa|otp)\s*[:=]\s*(?=\S*[\d!@#$%^&*])\S{4,}/i,
];

/** A note must never hold a credential: memory goes into prompts. */
export const looksSecret = (text: string) => SECRET_SHAPES.some((re) => re.test(text));

type Filters = {
  view?: MemoryView | undefined;
  scope?: MemoryScope | undefined;
  project_id?: string | undefined;
  agent_id?: string | undefined;
  exclude?: string[] | undefined;
};

/** The notes a view may see, narrowed by the given filters. */
function visibleWhere(f: Filters) {
  return (eb: ExpressionBuilder<Database, "memories">) => {
    const v = f.view;
    const conds = v
      ? [
          eb.or([
            eb("memories.scope", "=", "global"),
            eb.and([eb("memories.scope", "=", "project"), eb("memories.project_id", "=", v.project_id ?? "")]),
            eb.and([eb("memories.scope", "=", "agent"), eb("memories.agent_id", "=", v.agent_id)]),
          ]),
        ]
      : [];
    if (f.scope) conds.push(eb("memories.scope", "=", f.scope));
    if (f.project_id) conds.push(eb("memories.project_id", "=", f.project_id));
    if (f.agent_id) conds.push(eb("memories.agent_id", "=", f.agent_id));
    if (f.exclude?.length) conds.push(eb("memories.id", "not in", f.exclude));
    return eb.and(conds);
  };
}

export function memoriesRepo({ one, all, run }: Sql) {
  const repo = {
    get(id: string): Memory | undefined {
      const r = one(qb.selectFrom("memories").selectAll().where("id", "=", id));
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
      tainted?: boolean | undefined;
    }): Memory {
      const same = one(
        qb
          .selectFrom("memories")
          .select("id")
          .where("scope", "=", m.scope)
          .where(raw<string>`ifnull(project_id, '')`, "=", m.project_id ?? "")
          .where(raw<string>`ifnull(agent_id, '')`, "=", m.agent_id ?? "")
          // Both sides through SQLite's own lower(): the same text matches whatever its accents.
          .where(raw<string>`lower(trim(text))`, "=", raw<string>`lower(trim(${m.text}))`),
      );
      if (same) return repo.get(same.id) as Memory;
      const id = newId("mem");
      const at = now();
      run(
        qb.insertInto("memories").values({
          id,
          scope: m.scope,
          project_id: m.project_id ?? null,
          agent_id: m.agent_id ?? null,
          text: m.text,
          source: m.source,
          author_agent: m.author_agent ?? null,
          thread_id: m.thread_id ?? null,
          tainted: m.tainted ? 1 : 0,
          created_at: at,
          updated_at: at,
        }),
      );
      return repo.get(id) as Memory;
    },
    edit(id: string, text: string, tainted: boolean): Memory | undefined {
      run(
        qb
          .updateTable("memories")
          .set({ text, tainted: tainted ? 1 : 0, updated_at: now() })
          .where("id", "=", id),
      );
      return repo.get(id);
    },
    remove(id: string): boolean {
      return run(qb.deleteFrom("memories").where("id", "=", id)) > 0;
    },
    /** Newest first, or with `query` the best full-text matches first. */
    list(o: Filters & { query?: string | undefined; limit: number }): Memory[] {
      const match = o.query ? ftsQuery(o.query) : undefined;
      if (o.query && !match) return [];
      const rows = match
        ? all(
            qb
              .selectFrom("memories_fts")
              .innerJoin("memories", "memories.n", "memories_fts.rowid")
              .selectAll("memories")
              .where(raw<boolean>`memories_fts MATCH ${match}`)
              .where(visibleWhere(o))
              .orderBy(raw`bm25(memories_fts)`)
              .limit(o.limit),
          )
        : all(
            qb.selectFrom("memories").selectAll().where(visibleWhere(o)).orderBy("updated_at", "desc").limit(o.limit),
          );
      return rows.map(toMemory);
    },
  };
  return repo;
}

export type Memories = ReturnType<typeof memoriesRepo>;
