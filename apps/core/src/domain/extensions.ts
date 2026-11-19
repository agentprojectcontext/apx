// Installed extensions: the manifest as it was read at install, the copy's folder and fingerprint, on or off, where it
// came from by fingerprint, and the version it replaced (kept to go back to).
import { ExtensionManifest, type ExtensionProvenance } from "@apx/protocol";
import { now, qb, type Sql } from "./sql.ts";

/** A version kept beside the installed one: as it was when replaced, approved or not. */
export type PreviousVersion = {
  manifest: ExtensionManifest;
  hash: string;
  source: string;
  origin_key?: string | undefined;
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
  origin_key?: string | undefined;
  enabled: boolean;
  installed_at: string;
  provenance: ExtensionProvenance;
  previous: PreviousVersion | undefined;
  /** Its plain settings as the owner set them (manifest 2). */
  settings: Record<string, string | number | boolean>;
  /** The agents the owner added from it: its agent's id → the agent's id in APX. */
  added_agents: Record<string, string>;
};

/** A manifest as stored: read again through the schema, so one stored before a field existed gets its default. */
function manifestOf(raw: string): ExtensionManifest {
  const json: unknown = JSON.parse(raw);
  const p = ExtensionManifest.safeParse(json);
  return p.success ? p.data : (json as ExtensionManifest);
}

function settingsOf(raw: string | null): Record<string, string | number | boolean> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, string | number | boolean>) : {};
  } catch {
    return {};
  }
}

function addedOf(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).filter((x): x is [string, string] => typeof x[1] === "string"))
      : {};
  } catch {
    return {};
  }
}

type NewRecord = Omit<ExtensionRecord, "enabled" | "installed_at" | "settings" | "added_agents"> & {
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
    origin_key: string | null;
    enabled: number;
    installed_at: string;
    provenance: string;
    previous: string | null;
    settings: string | null;
    added_agents: string | null;
  }): ExtensionRecord => ({
    id: r.id,
    manifest: manifestOf(r.manifest),
    hash: r.hash,
    dir: r.dir,
    source: r.source,
    ...(r.origin_key ? { origin_key: r.origin_key } : {}),
    enabled: Boolean(r.enabled),
    installed_at: r.installed_at,
    provenance: provenanceOf(r.provenance),
    previous: previousOf(r.previous),
    settings: settingsOf(r.settings),
    added_agents: addedOf(r.added_agents),
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
        origin_key: e.origin_key ?? null,
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
    /** The same files under another fingerprint (how it is computed changed); on or off stays as it is. */
    setHash(id: string, hash: string): void {
      run(qb.updateTable("extensions").set({ hash, updated_at: now() }).where("id", "=", id));
    },
    setSettings(id: string, values: Record<string, string | number | boolean>): void {
      run(
        qb
          .updateTable("extensions")
          .set({ settings: JSON.stringify(values), updated_at: now() })
          .where("id", "=", id),
      );
    },
    /** One more agent the owner added from it (an update keeps the list). */
    addAgent(id: string, agent: string, apxId: string): void {
      const cur = repo.get(id);
      if (!cur) return;
      run(
        qb
          .updateTable("extensions")
          .set({ added_agents: JSON.stringify({ ...cur.added_agents, [agent]: apxId }), updated_at: now() })
          .where("id", "=", id),
      );
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
