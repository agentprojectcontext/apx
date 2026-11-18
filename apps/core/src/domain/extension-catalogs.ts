// Extension catalogs the owner added for themself: where each is, the ref and commit it was last read at, and what it
// lists. What is listed is APX's own reading of it (see extensions/catalogs.ts), kept as JSON.
import { now, qb, type Sql } from "./sql.ts";

/** Where an entry's files come from: a packed .apxext, a folder of the catalog's repository, or another repository at a commit. */
export type CatalogVia =
  | { type: "archive"; url: string; sha256?: string | undefined }
  | { type: "path"; path: string }
  | { type: "git"; url: string; sha: string; path?: string | undefined };

export type CatalogItem = {
  id: string;
  name: string;
  description: string;
  version: string;
  category?: string | undefined;
  homepage?: string | undefined;
  license?: string | undefined;
  /** A Claude Code plugin, turned into an extension when installed. */
  plugin: boolean;
  via: CatalogVia;
};

export type CatalogSkip = { name: string; reason: "license" | "unpinned" | "source" | "invalid" };

export type CatalogRecord = {
  id: string;
  name: string;
  source: string;
  kind: "apx" | "claude";
  ref: string | undefined;
  synced_sha: string | undefined;
  synced_at: string | undefined;
  entries: CatalogItem[];
  skipped: CatalogSkip[];
  created_at: string;
};

const json = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export function extensionCatalogsRepo({ one, all, run }: Sql) {
  const toRecord = (r: {
    id: string;
    name: string;
    source: string;
    kind: string;
    ref: string | null;
    synced_sha: string | null;
    synced_at: string | null;
    entries: string;
    skipped: string;
    created_at: string;
  }): CatalogRecord => ({
    id: r.id,
    name: r.name,
    source: r.source,
    kind: r.kind === "claude" ? "claude" : "apx",
    ref: r.ref ?? undefined,
    synced_sha: r.synced_sha ?? undefined,
    synced_at: r.synced_at ?? undefined,
    entries: json<CatalogItem[]>(r.entries, []),
    skipped: json<CatalogSkip[]>(r.skipped, []),
    created_at: r.created_at,
  });
  const repo = {
    get(id: string): CatalogRecord | undefined {
      const r = one(qb.selectFrom("extension_catalogs").selectAll().where("id", "=", id));
      return r ? toRecord(r) : undefined;
    },
    list(): CatalogRecord[] {
      return all(qb.selectFrom("extension_catalogs").selectAll().orderBy("created_at")).map(toRecord);
    },
    /** Adds or replaces one with what it lists now. */
    put(c: Omit<CatalogRecord, "created_at">): CatalogRecord {
      const fields = {
        name: c.name,
        source: c.source,
        kind: c.kind,
        ref: c.ref ?? null,
        synced_sha: c.synced_sha ?? null,
        synced_at: c.synced_at ?? null,
        entries: JSON.stringify(c.entries),
        skipped: JSON.stringify(c.skipped),
      };
      run(
        qb
          .insertInto("extension_catalogs")
          .values({ id: c.id, ...fields, created_at: now() })
          .onConflict((oc) => oc.column("id").doUpdateSet(fields)),
      );
      return repo.get(c.id) as CatalogRecord;
    },
    remove(id: string): boolean {
      return run(qb.deleteFrom("extension_catalogs").where("id", "=", id)) > 0;
    },
  };
  return repo;
}
