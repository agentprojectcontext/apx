// Installed extensions: the manifest as it was read at install, the copy's folder and fingerprint, on or off.
import type { ExtensionManifest } from "@apx/protocol";
import { now, qb, type Sql } from "./sql.ts";

export type ExtensionRecord = {
  id: string;
  manifest: ExtensionManifest;
  hash: string;
  dir: string;
  source: string;
  enabled: boolean;
  installed_at: string;
};

export function extensionsRepo({ one, all, run }: Sql) {
  const toRecord = (r: {
    id: string;
    manifest: string;
    hash: string;
    dir: string;
    source: string;
    enabled: number;
    installed_at: string;
  }): ExtensionRecord => ({
    id: r.id,
    manifest: JSON.parse(r.manifest) as ExtensionManifest,
    hash: r.hash,
    dir: r.dir,
    source: r.source,
    enabled: Boolean(r.enabled),
    installed_at: r.installed_at,
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
    /** Adds or replaces one; a changed fingerprint turns it off until the owner turns it on again. */
    put(e: Omit<ExtensionRecord, "enabled" | "installed_at">): ExtensionRecord {
      const cur = one(qb.selectFrom("extensions").select(["hash", "enabled"]).where("id", "=", e.id));
      const at = now();
      const enabled = cur && cur.hash === e.hash ? cur.enabled : 0;
      run(
        qb
          .insertInto("extensions")
          .values({
            id: e.id,
            manifest: JSON.stringify(e.manifest),
            hash: e.hash,
            dir: e.dir,
            source: e.source,
            enabled,
            installed_at: at,
            updated_at: at,
          })
          .onConflict((oc) =>
            oc.column("id").doUpdateSet({
              manifest: JSON.stringify(e.manifest),
              hash: e.hash,
              dir: e.dir,
              source: e.source,
              enabled,
              updated_at: at,
            }),
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
