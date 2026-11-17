// Installed extensions: the manifest as it was read at install, the copy's folder and fingerprint, on or off, where it
// came from by fingerprint, and the version it replaced (kept to go back to).
import type { ExtensionManifest, ExtensionProvenance } from "@apx/protocol";
import { now, qb, type Sql } from "./sql.ts";

/** A version kept beside the installed one: as it was when replaced, approved or not. */
export type PreviousVersion = {
  manifest: ExtensionManifest;
  hash: string;
  source: string;
  provenance: ExtensionProvenance;
  enabled: boolean;
  installed_at: string;
};

export type ExtensionRecord = {
  id: string;
  manifest: ExtensionManifest;
  hash: string;
  dir: string;
  source: string;
  enabled: boolean;
  installed_at: string;
  provenance: ExtensionProvenance;
  previous: PreviousVersion | undefined;
};

type NewRecord = Omit<ExtensionRecord, "enabled" | "installed_at"> & {
  /** Kept on although its files changed (an official update asking for nothing more). */
  keepOn?: boolean;
  /** Set as given (going back to a version as it was approved); otherwise decided by its fingerprint. */
  enabled?: boolean;
  installed_at?: string;
};

const provenanceOf = (v: string): ExtensionProvenance => (v === "official" ? "official" : "third_party");

function previousOf(raw: string | null): PreviousVersion | undefined {
  if (!raw) return undefined;
  try {
    const p = JSON.parse(raw) as PreviousVersion;
    return { ...p, provenance: provenanceOf(p.provenance), enabled: Boolean(p.enabled) };
  } catch {
    return undefined;
  }
}

export function extensionsRepo({ one, all, run }: Sql) {
  const toRecord = (r: {
    id: string;
    manifest: string;
    hash: string;
    dir: string;
    source: string;
    enabled: number;
    installed_at: string;
    provenance: string;
    previous: string | null;
  }): ExtensionRecord => ({
    id: r.id,
    manifest: JSON.parse(r.manifest) as ExtensionManifest,
    hash: r.hash,
    dir: r.dir,
    source: r.source,
    enabled: Boolean(r.enabled),
    installed_at: r.installed_at,
    provenance: provenanceOf(r.provenance),
    previous: previousOf(r.previous),
  });
  const repo = {
    get(id: string): ExtensionRecord | undefined {
      const r = one(qb.selectFrom("extensions").selectAll().where("id", "=", id));
      return r ? toRecord(r) : undefined;
    },
    list(): ExtensionRecord[] {
      return all(qb.selectFrom("extensions").selectAll().orderBy("id")).map(toRecord);
    },
    enabled(): ExtensionRecord[] {
      return all(qb.selectFrom("extensions").selectAll().where("enabled", "=", 1).orderBy("id")).map(toRecord);
    },
    /** Adds or replaces one; a changed fingerprint turns it off until the owner turns it on again (unless `keepOn`). */
    put(e: NewRecord): ExtensionRecord {
      const cur = one(qb.selectFrom("extensions").select(["hash", "enabled"]).where("id", "=", e.id));
      const at = now();
      const enabled =
        e.enabled !== undefined ? (e.enabled ? 1 : 0) : cur && (cur.hash === e.hash || e.keepOn) ? cur.enabled : 0;
      const fields = {
        manifest: JSON.stringify(e.manifest),
        hash: e.hash,
        dir: e.dir,
        source: e.source,
        enabled,
        provenance: e.provenance,
        previous: e.previous ? JSON.stringify(e.previous) : null,
        updated_at: at,
      };
      run(
        qb
          .insertInto("extensions")
          .values({ id: e.id, ...fields, installed_at: e.installed_at ?? at })
          .onConflict((oc) =>
            oc
              .column("id")
              .doUpdateSet({ ...fields, ...(e.installed_at !== undefined ? { installed_at: e.installed_at } : {}) }),
          ),
      );
      return repo.get(e.id) as ExtensionRecord;
    },
    setEnabled(id: string, enabled: boolean): void {
      run(
        qb
          .updateTable("extensions")
          .set({ enabled: enabled ? 1 : 0, updated_at: now() })
          .where("id", "=", id),
      );
    },
    remove(id: string): boolean {
      return run(qb.deleteFrom("extensions").where("id", "=", id)) > 0;
    },
  };
  return repo;
}
