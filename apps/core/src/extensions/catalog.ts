// The official APX catalog (`index.json` from the public marketplace repo): an extension is Official when the
// catalog lists its id and version with the same fingerprint and the official tier; anything else is third party.
// Asked only when an extension is inspected or installed (no timer), kept in the home with its ETag. See
// DECISIONS.md#d-240
import fs from "node:fs";
import path from "node:path";
import { EXTENSION_ARCHIVE_MAX, type ExtensionProvenance } from "@apx/protocol";
import { loopbackHost } from "@apx/protocol/browser-urls";
import { z } from "zod";

/** The copy of the official catalog this APX ships (official-catalog.json beside this file), read when needed. */
export function shippedCatalog(): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "official-catalog.json"), "utf8"));
  } catch {
    return undefined;
  }
}

/** The newest catalog format this APX reads; a newer one is set aside whole and the owner told to update APX. */
const SCHEMA = 1;
const CATALOG_MAX = 5 * 1024 * 1024;
const CATALOG_MS = 10_000;
/** Within this, the kept copy answers without asking the server again. */
const FRESH_MS = 10 * 60_000;
const DOWNLOAD_MS = 60_000;

const Version = z.object({
  version: z.string(),
  content_hash: z.string().optional(),
  apx: z.string().optional(),
  published_at: z.string().max(40).optional(),
  archive: z.object({ url: z.string(), sha256: z.string() }).optional(),
  /** The package's listing copy, as the catalog extracted it. */
  card: z.unknown().optional(),
  /** A pulled version: never installed new. */
  yanked: z.string().optional(),
});
const Entry = z.object({
  id: z.string(),
  kind: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  categories: z.array(z.string()).optional(),
  /** Copied from its listing (schema 2), to list it before its package is read. */
  tagline: z.string().max(60).optional(),
  category: z.string().max(60).optional(),
  /** Absolute https addresses of its `apx-listing.json` and its icon. */
  listing: z.string().max(500).startsWith("https://").optional(),
  icon: z.string().max(500).startsWith("https://").optional(),
  tier: z.string().optional(),
  versions: z.array(z.unknown()).default([]),
});
export type ListedVersion = z.infer<typeof Version>;
export type Listed = {
  id: string;
  kind: string | undefined;
  name: string;
  description: string;
  categories: string[];
  tagline: string | undefined;
  category: string | undefined;
  listing: string | undefined;
  icon: string | undefined;
  tier: string | undefined;
  versions: ListedVersion[];
};

/** Entries that read well; one broken entry never hides the others. Unknown fields are ignored. */
function parseIndex(raw: unknown): { schema: number; entries: Listed[] } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { schema?: unknown; entries?: unknown };
  if (typeof r.schema !== "number" || !Array.isArray(r.entries)) return undefined;
  const entries: Listed[] = [];
  for (const e of r.entries) {
    const p = Entry.safeParse(e);
    if (!p.success) continue;
    const versions = p.data.versions.flatMap((v) => {
      const pv = Version.safeParse(v);
      return pv.success ? [pv.data] : [];
    });
    entries.push({
      id: p.data.id,
      kind: p.data.kind,
      name: p.data.name ?? p.data.id,
      description: p.data.description ?? "",
      categories: p.data.categories ?? [],
      tagline: p.data.tagline,
      category: p.data.category,
      listing: p.data.listing,
      icon: p.data.icon,
      tier: p.data.tier,
      versions,
    });
  }
  return { schema: r.schema, entries };
}

/** What the catalog lets APX fetch: https, or this computer over http (a local copy, a test). */
function catalogUrlAllowed(url: string): boolean {
  const u = URL.parse(url);
  return Boolean(u && (u.protocol === "https:" || (u.protocol === "http:" && loopbackHost(u.hostname))));
}

/** A body read up to `max` bytes; past that the download stops. */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new Error("too big");
  const chunks: Buffer[] = [];
  let total = 0;
  if (!res.body) return Buffer.alloc(0);
  for await (const chunk of res.body) {
    total += chunk.byteLength;
    if (total > max) throw new Error("too big");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** A small file (a listing, an icon) from an https address, following redirects but never off https. */
export async function fetchSmall(url: string, max: number, doFetch: typeof fetch = fetch): Promise<Buffer | undefined> {
  if (URL.parse(url)?.protocol !== "https:") return undefined;
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(CATALOG_MS), redirect: "follow" });
    if (!res.ok || (res.url && URL.parse(res.url)?.protocol !== "https:")) return undefined;
    return await readCapped(res, max);
  } catch {
    return undefined;
  }
}

/** The download itself failed (no network, the server answered an error, it broke): worth trying again. */
export class DownloadError extends Error {}

/** Downloads an .apxext from an https address, up to the size an uploaded one may have. */
export async function downloadArchive(url: string, doFetch: typeof fetch = fetch): Promise<Buffer> {
  if (URL.parse(url)?.protocol !== "https:") throw new Error("an extension is downloaded only from an https address");
  let res: Response;
  try {
    res = await doFetch(url, { signal: AbortSignal.timeout(DOWNLOAD_MS), redirect: "follow" });
  } catch {
    throw new DownloadError(`could not download ${url}`);
  }
  // A redirect may not leave https.
  if (res.url && URL.parse(res.url)?.protocol !== "https:") throw new Error("the download left https");
  if (!res.ok) throw new DownloadError(`the download answered ${res.status}`);
  try {
    return await readCapped(res, EXTENSION_ARCHIVE_MAX);
  } catch {
    throw new DownloadError(`the file is larger than ${EXTENSION_ARCHIVE_MAX / 1024 / 1024} MB, or the download broke`);
  }
}

type Kept = { url: string; etag?: string; fetched_at: number; index: unknown };

export type CatalogCheck = { provenance: ExtensionProvenance; catalog?: "unreachable" | "needs_update" };

export function createCatalog(deps: {
  home: string;
  /** The catalog's address; undefined: none is asked and everything is third party. */
  url: string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  /** The copy APX ships of the official catalog: what is listed while none was ever fetched (offline). */
  shipped?: () => unknown;
}) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const file = path.join(deps.home, "marketplace", "catalog.json");

  const readKept = (): Kept | undefined => {
    try {
      const k = JSON.parse(fs.readFileSync(file, "utf8")) as Kept;
      return k.url === deps.url ? k : undefined;
    } catch {
      return undefined;
    }
  };
  const keep = (k: Kept) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(k));
    fs.renameSync(tmp, file);
  };

  /** The catalog now: the kept copy while fresh, else asked again (ETag); a failure falls back to the kept copy. */
  async function index(refresh = false): Promise<unknown> {
    const url = deps.url;
    if (!url || !catalogUrlAllowed(url)) return undefined;
    const kept = readKept();
    if (kept && !refresh && now() - kept.fetched_at < FRESH_MS) return kept.index;
    try {
      const res = await doFetch(url, {
        signal: AbortSignal.timeout(CATALOG_MS),
        headers: { accept: "application/json", ...(kept?.etag ? { "if-none-match": kept.etag } : {}) },
      });
      if (res.status === 304 && kept) {
        keep({ ...kept, fetched_at: now() });
        return kept.index;
      }
      if (!res.ok) return kept?.index ?? deps.shipped?.();
      const parsed: unknown = JSON.parse((await readCapped(res, CATALOG_MAX)).toString("utf8"));
      const etag = res.headers.get("etag") ?? undefined;
      keep({ url, ...(etag ? { etag } : {}), fetched_at: now(), index: parsed });
      return parsed;
    } catch {
      return kept?.index ?? deps.shipped?.();
    }
  }

  return {
    /**
     * The extensions it lists (integration entries and pulled versions left out), or why there are none: no catalog
     * reachable now and none kept, or one this APX is too old to read.
     */
    async entries(refresh = false): Promise<{ entries: Listed[]; catalog?: "unreachable" | "needs_update" }> {
      const parsed = parseIndex(await index(refresh));
      if (!parsed) return { entries: [], ...(deps.url ? { catalog: "unreachable" as const } : {}) };
      if (parsed.schema > SCHEMA) return { entries: [], catalog: "needs_update" };
      const entries = parsed.entries
        .filter((e) => (e.kind ?? "extension") === "extension")
        .map((e) => ({ ...e, versions: e.versions.filter((v) => !v.yanked) }))
        .filter((e) => e.versions.length);
      return { entries };
    },
    /** Official when the catalog lists this id and version with this fingerprint under the official tier. */
    async check(id: string, version: string, hash: string): Promise<CatalogCheck> {
      const parsed = parseIndex(await index());
      if (!parsed) return { provenance: "third_party", ...(deps.url ? { catalog: "unreachable" as const } : {}) };
      if (parsed.schema > SCHEMA) return { provenance: "third_party", catalog: "needs_update" };
      const official = parsed.entries.some(
        (e) =>
          e.id === id &&
          e.tier === "official" &&
          e.versions.some((v) => v.version === version && v.content_hash === hash),
      );
      return { provenance: official ? "official" : "third_party" };
    },
  };
}

export type Catalog = ReturnType<typeof createCatalog>;
