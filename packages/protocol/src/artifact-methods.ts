// An artifact's own memory (store, db), its bundle and its credentialed fetch. `surface` is fixed by the host,
// never chosen by the page.
import { z } from "zod";
import { ElementEdit, PickedElement } from "./browser.ts";
import { ArtifactBundle, ArtifactMemory, ArtifactSqlParam, Id, SurfaceSummary } from "./domain.ts";

/** A widget open in edit mode: a throwaway page of the core's own browser, not a tab anyone browses. */
const EditPage = z.string().regex(/^w\d{1,9}$/);
const Fraction = z.number().min(0).max(1);

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
  /**
   * Edit mode for a widget: the core runs it in a page of its own browser, cut off from the network and from the
   * owner's logins, sized to `width`, with the panel's theme (`theme`: CSS custom properties only). Owner only.
   */
  "surfaces.edit_open": {
    params: z
      .object({
        surface: Id,
        width: z.number().int().min(240).max(2400),
        theme: z
          .string()
          .max(40_000)
          .regex(/^[^<>]*$/),
        mode: z.enum(["light", "dark"]),
      })
      .strict(),
    result: z.object({ page: EditPage }),
    effect: true,
    access: "human",
  },
  /** The widget's element under a point of its page (fractions 0–1), or null. */
  "surfaces.edit_inspect": {
    params: z.object({ page: EditPage, x: Fraction, y: Fraction }).strict(),
    result: z.object({ element: PickedElement.nullable() }),
    effect: false,
    access: "human",
  },
  /** Shows exactly these edits in the widget's edit page; an empty list undoes them. */
  "surfaces.edit_preview": {
    params: z.object({ page: EditPage, edits: z.array(ElementEdit).max(50) }).strict(),
    result: z.object({ shown: z.number().int() }),
    effect: true,
    access: "human",
  },
  /** A picture of the widget's edit page. */
  "surfaces.edit_shot": {
    params: z.object({ page: EditPage }).strict(),
    result: z.object({ mime: z.literal("image/jpeg"), data: z.string(), bytes: z.number().int() }),
    effect: false,
    access: "human",
  },
  "surfaces.edit_close": {
    params: z.object({ page: EditPage }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
} as const;
