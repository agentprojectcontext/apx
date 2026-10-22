// An artifact's own memory (store, db), its bundle and its credentialed fetch. `surface` is fixed by the host,
// never chosen by the page.
import { z } from "zod";
import { ArtifactBundle, ArtifactMemory, ArtifactSqlParam, Id, SurfaceSummary } from "./domain.ts";

const Sql = z.string().trim().min(1).max(100_000);
const SqlParams = z.array(ArtifactSqlParam).max(1000).optional();

export const artifactMethods = {
  /** Values of the artifact's store (APX.store): only `keys` when given, else every key. */
  "surfaces.store_get": {
    params: z.object({ surface: Id, keys: z.array(z.string().min(1).max(200)).max(1000).optional() }).strict(),
    result: z.object({ values: z.record(z.string(), z.unknown()) }),
    effect: false,
  },
  /** Sets store keys (a null removes one). Refused past ARTIFACT_STORE_MAX bytes in all. */
  "surfaces.store_set": {
    params: z.object({ surface: Id, patch: z.record(z.string().min(1).max(200), z.unknown()) }).strict(),
    result: z.object({ keys: z.number().int(), bytes: z.number().int() }),
    effect: true,
  },
  /** A read-only query on the artifact's database (APX.db); at most 2,000 rows / 2 MB come back. */
  "surfaces.db_query": {
    params: z.object({ surface: Id, sql: Sql, params: SqlParams }).strict(),
    result: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.unknown())) }),
    effect: false,
  },
  /** A writing statement on the artifact's database; no ATTACH, PRAGMA, VACUUM or extensions. */
  "surfaces.db_exec": {
    params: z.object({ surface: Id, sql: Sql, params: SqlParams }).strict(),
    result: z.object({ changes: z.number().int(), last_id: z.number().int().nullable() }),
    effect: true,
  },
  /** What the artifact remembers, by size. */
  "surfaces.memory": {
    params: z.object({ surface: Id }).strict(),
    result: ArtifactMemory,
    effect: false,
  },
  /** Forgets parts of what the artifact remembers; "secrets" forgets where its secrets are pinned, not their values. */
  "surfaces.memory_clear": {
    params: z.object({ surface: Id, parts: z.array(z.enum(["state", "store", "db", "secrets"])).min(1) }).strict(),
    result: ArtifactMemory,
    effect: true,
    access: "human",
  },
  /** The artifact as a bundle; its memory only with `memory: true` (an upload never carries the owner's data). */
  "surfaces.export": {
    params: z.object({ surface: Id, memory: z.boolean().default(false) }).strict(),
    result: ArtifactBundle,
    effect: false,
    access: "human",
  },
  /** Installs a bundle as a new artifact of a project (none: global); a taken name gets "-2". */
  "surfaces.import": {
    params: z.object({ bundle: ArtifactBundle, project: Id.optional() }).strict(),
    result: SurfaceSummary,
    effect: true,
    access: "human",
  },
  /**
   * Runs a page in a throwaway headless tab, the way a host would show it (kit inlined, a bridge answered by an empty
   * scratch memory, no network), and returns what it threw while starting. `checked` is false when no browser runs here.
   */
  "surfaces.check": {
    params: z.object({ html: z.string().min(1).max(400_000) }).strict(),
    /** `text`: what the page shows once started, for a failure it caught and only wrote on screen. */
    result: z.object({
      checked: z.boolean(),
      errors: z.array(z.string()),
      text: z.string(),
      /** Each of an app's views, opened in turn: its label and what its panel shows. */
      views: z.array(z.object({ view: z.string(), text: z.string() })),
    }),
    effect: false,
  },
  /**
   * An HTTP call from the artifact through the core: the url's origin must be one of its `connect`, and `secret`
   * names one of its own secrets (`artifact.<name>.<key>`), injected here and never returned. 30 s, body ≤2 MB.
   * A secret is pinned to the first origin it reaches and refused anywhere else until the owner resets the pins.
   */
  "surfaces.fetch": {
    params: z
      .object({
        surface: Id,
        url: z.string().min(1).max(4000),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).default("GET"),
        headers: z.record(z.string().max(200), z.string().max(8000)).optional(),
        body: z.string().max(2_000_000).optional(),
        secret: z
          .object({
            /** The key, or its full name `artifact.<name>.<key>`; any other secret is refused. */
            name: z.string().min(1).max(200),
            in: z.enum(["bearer", "header", "query", "form"]),
            param: z.string().min(1).max(200).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    result: z.object({ status: z.number().int(), headers: z.record(z.string(), z.string()), body: z.string() }),
    effect: false,
  },
} as const;
