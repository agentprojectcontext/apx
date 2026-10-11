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
  ...opt("run_id", r.run_id),
  tainted: Boolean(r.tainted),
  pending: Boolean(r.pending),
  ...opt("forgotten_at", r.forgotten_at),
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
    "under upon onto ante bajo contra desde durante hacia hasta mediante segun tras " +
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
  /** Only notes waiting for the owner (true) or only the ones that stand (false). */
  pending?: boolean | undefined;
  /** The forgotten notes instead of the live ones (the owner's list, to bring one back). */
  forgotten?: boolean | undefined;
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
    if (f.pending !== undefined) conds.push(eb("memories.pending", "=", f.pending ? 1 : 0));
    conds.push(eb("memories.forgotten_at", f.forgotten ? "is not" : "is", null));
    return eb.and(conds);
  };
}

/** Cosine similarity of two vectors of the same length. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Merges rankings (by words, by meaning) into one: a note high in either list comes first (reciprocal rank fusion,
 * the usual k = 60).
 */
export function fuse(lists: Memory[][], limit: number): Memory[] {
  const score = new Map<string, { m: Memory; s: number }>();
  for (const list of lists)
    list.forEach((m, rank) => {
      const cur = score.get(m.id) ?? { m, s: 0 };
      cur.s += 1 / (60 + rank);
      score.set(m.id, cur);
    });
  return [...score.values()]
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.m);
}

/** A note's vector is stored as the raw float32 bytes. */
const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

/** Notes this close to a query (cosine) are related; below it a match is noise. */
const MIN_SIMILARITY = 0.35;
/** A related note stands this close to the best one… */
const NEAR_BEST = 0.1;
/** …and, among several notes, this far above the usual level of the rest. */
const ABOVE_TYPICAL = 0.05;

/**
 * The score a note needs to count, from all the scores (best first). Many engines rate unrelated text well above the
 * floor, so with a handful of notes every one of them would match: the cut also follows the best one and, with
 * enough notes to tell, the median.
 */
export function relatedCut(scores: number[]): number {
  const best = scores[0] ?? 0;
  const median = scores.length >= 5 ? (scores[Math.floor(scores.length / 2)] ?? 0) : 0;
  return Math.max(MIN_SIMILARITY, best - NEAR_BEST, median + ABOVE_TYPICAL);
}

export function memoriesRepo({ one, all, run }: Sql) {
  const repo = {
    get(id: string): Memory | undefined {
      const r = one(qb.selectFrom("memories").selectAll().where("id", "=", id));
      return r ? toMemory(r) : undefined;
    },
    /** Adds a note; the same text already in the same place (even forgotten) is returned instead of a copy. */
    add(m: {
      scope: MemoryScope;
      project_id?: string | undefined;
      agent_id?: string | undefined;
      text: string;
      source: "owner" | "agent";
      author_agent?: string | undefined;
      thread_id?: string | undefined;
      run_id?: string | undefined;
      tainted?: boolean | undefined;
      pending?: boolean | undefined;
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
          run_id: m.run_id ?? null,
          tainted: m.tainted ? 1 : 0,
          pending: m.pending ? 1 : 0,
          created_at: at,
          updated_at: at,
        }),
      );
      return repo.get(id) as Memory;
    },
    edit(id: string, text: string, o: { tainted: boolean; pending: boolean }): Memory | undefined {
      // New words, new meaning: the note is indexed again.
      run(
        qb
          .updateTable("memories")
          .set({
            text,
            tainted: o.tainted ? 1 : 0,
            pending: o.pending ? 1 : 0,
            updated_at: now(),
            embedding: null,
            embedding_model: null,
          })
          .where("id", "=", id),
      );
      return repo.get(id);
    },
    /** The owner confirms a note an agent wrote about them: from now on it stands like their own. */
    confirm(id: string): Memory | undefined {
      run(qb.updateTable("memories").set({ pending: 0, updated_at: now() }).where("id", "=", id));
      return repo.get(id);
    },
    /** Out of every turn and search, but kept: the owner can bring it back (or delete it for good). */
    forget(id: string): boolean {
      return (
        run(
          qb
            .updateTable("memories")
            .set({ forgotten_at: now() })
            .where("id", "=", id)
            .where("forgotten_at", "is", null),
        ) > 0
      );
    },
    restore(id: string): Memory | undefined {
      run(qb.updateTable("memories").set({ forgotten_at: null, updated_at: now() }).where("id", "=", id));
      return repo.get(id);
    },
    remove(id: string): boolean {
      return run(qb.deleteFrom("memories").where("id", "=", id)) > 0;
    },
    setEmbedding(id: string, vector: Float32Array, model: string): void {
      run(
        qb
          .updateTable("memories")
          .set({ embedding: toBlob(vector), embedding_model: model })
          .where("id", "=", id),
      );
    },
    /** Notes not indexed with this engine and model yet (new, edited, or indexed by another engine). */
    unindexed(model: string, limit: number): Array<{ id: string; text: string }> {
      return all(
        qb
          .selectFrom("memories")
          .select(["id", "text"])
          .where((eb) => eb.or([eb("embedding_model", "is", null), eb("embedding_model", "!=", model)]))
          .limit(limit),
      );
    },
    counts(model: string | undefined): { indexed: number; total: number } {
      const total = one(qb.selectFrom("memories").select((eb) => eb.fn.countAll<number>().as("n")))?.n ?? 0;
      const indexed = model
        ? (one(
            qb
              .selectFrom("memories")
              .select((eb) => eb.fn.countAll<number>().as("n"))
              .where("embedding_model", "=", model),
          )?.n ?? 0)
        : 0;
      return { indexed: Number(indexed), total: Number(total) };
    },
    /** The visible notes closest in meaning to `vector`, among those indexed with `model`. */
    nearest(o: Filters & { vector: Float32Array; model: string; limit: number }): Memory[] {
      const rows = all(
        qb
          .selectFrom("memories")
          .selectAll()
          .where(visibleWhere(o))
          .where("embedding_model", "=", o.model)
          .where("embedding", "is not", null),
      );
      const scored = rows
        .map((r) => ({ r, s: cosine(o.vector, fromBlob(r.embedding as Uint8Array)) }))
        .sort((a, b) => b.s - a.s);
      const cut = relatedCut(scored.map((x) => x.s));
      return scored
        .filter((x) => x.s >= cut)
        .slice(0, o.limit)
        .map((x) => toMemory(x.r));
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
