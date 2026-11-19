// What each catalog package brings, read from the package itself: its .apxext is downloaded once, checked against the
// catalog's sha256 and fingerprint, and only its manifest and listing are kept, by fingerprint, in the home. Nothing
// is installed or run. Asked when the owner browses the catalog, never on a timer (DECISIONS.md#d-241).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type CatalogEntry, ExtensionManifest } from "@apx/protocol";
import { isInside, samePath } from "../paths.ts";
import { downloadArchive, fetchSmall, type Listed, type ListedVersion } from "./catalog.ts";
import { readArchive } from "./package.ts";
import { bringsOf, categoryOf, contentsOf, type ListingFile, listingCopy, needsOf, readListing } from "./summary.ts";

/** Downloads at once while filling; the rest wait their turn. */
const PARALLEL = 4;
/** An icon or screenshot kept to show; a bigger one is left out. */
export const ASSET_MAX = 2 * 1024 * 1024;
/** How long browsing waits for packages not read yet; the rest are kept for the next look as they arrive. */
const WAIT_MS = 15_000;

/** A package's kept files; `stale`: kept by an older APX, without its skills' lines, so it is read once more. */
type Known = {
  manifest: ExtensionManifest;
  listing?: ListingFile;
  skills?: { names: string[]; lines?: Record<string, string> };
  stale?: boolean;
};
/** What a kept package records; a file without it is read again when the catalog is next browsed. */
const KEPT = 2;

/** "1.10.0" after "1.9.2"; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => {
    const [core = "", pre] = v.split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d;
  }
  if (x.pre === y.pre) return 0;
  return x.pre === undefined ? 1 : y.pre === undefined ? -1 : x.pre < y.pre ? -1 : 1;
}

export const newest = (versions: ListedVersion[]) =>
  versions.reduce<ListedVersion | undefined>(
    (a, v) => (!a || compareVersions(v.version, a.version) > 0 ? v : a),
    undefined,
  );

export function createPackageReader(deps: { home: string; fetch?: typeof fetch; waitMs?: number }) {
  const dir = path.join(deps.home, "marketplace", "packages");
  const pending = new Map<string, Promise<void>>();

  const file = (hash: string) => path.join(dir, `${hash.replace(/[^0-9a-f]/g, "")}.json`);
  const known = (hash: string): Known | undefined => {
    try {
      const raw = JSON.parse(fs.readFileSync(file(hash), "utf8")) as {
        kept?: unknown;
        manifest?: unknown;
        listing?: unknown;
        skills?: unknown;
        skill_lines?: unknown;
      };
      const manifest = ExtensionManifest.safeParse(raw.manifest);
      if (!manifest.success) return undefined;
      const listing = readListing(raw.listing);
      // Kept by a newer read; one kept before has none (its skills are then counted, not named).
      const names = Array.isArray(raw.skills) ? raw.skills.filter((s) => typeof s === "string") : undefined;
      const lines =
        raw.skill_lines && typeof raw.skill_lines === "object"
          ? Object.fromEntries(
              Object.entries(raw.skill_lines).filter((e): e is [string, string] => typeof e[1] === "string"),
            )
          : undefined;
      return {
        manifest: manifest.data,
        ...(listing ? { listing } : {}),
        ...(names ? { skills: { names, ...(lines ? { lines } : {}) } } : {}),
        ...(raw.kept !== KEPT ? { stale: true } : {}),
      };
    } catch {
      return undefined;
    }
  };

  /** Whether a package was kept by this APX: false when it was never kept or an older APX kept it. */
  const fresh = (hash: string) => {
    const k = known(hash);
    return Boolean(k && !k.stale);
  };

  /** One package read and kept; a package that does not match what the catalog says is skipped, not kept. */
  const read = async (v: ListedVersion & { content_hash: string; archive: { url: string; sha256: string } }) => {
    const buf = await downloadArchive(v.archive.url, deps.fetch);
    if (createHash("sha256").update(buf).digest("hex") !== v.archive.sha256.toLowerCase()) return;
    const pkg = readArchive(buf);
    if (pkg.hash !== v.content_hash) return;
    let listing: unknown;
    if (pkg.files.includes("apx-listing.json")) {
      try {
        listing = JSON.parse(pkg.read("apx-listing.json").toString("utf8"));
      } catch {}
    }
    // Its icon and screenshots, to show its page before it is installed.
    const l = readListing(listing);
    const assets = path.join(dir, v.content_hash.replace(/[^0-9a-f]/g, ""));
    for (const f of [l?.icon, ...(l?.screenshots.map((x) => x.file) ?? [])]) {
      if (!f || !pkg.files.includes(f) || pkg.read(f).length > ASSET_MAX) continue;
      fs.mkdirSync(path.dirname(path.join(assets, f)), { recursive: true });
      fs.writeFileSync(path.join(assets, f), pkg.read(f));
    }
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file(v.content_hash)}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        kept: KEPT,
        manifest: pkg.manifest,
        ...(listing ? { listing } : {}),
        skills: pkg.skills,
        skill_lines: pkg.skillLines,
      }),
    );
    fs.renameSync(tmp, file(v.content_hash));
  };

  /** Reads the packages not known yet, a few at a time, waiting at most `waitMs` for them. */
  async function fill(versions: ListedVersion[]): Promise<void> {
    const todo = versions.filter(
      (v): v is ListedVersion & { content_hash: string; archive: { url: string; sha256: string } } =>
        Boolean(v.content_hash && v.archive && !fresh(v.content_hash)),
    );
    const queue = [...todo];
    const worker = async () => {
      for (let v = queue.shift(); v; v = queue.shift()) {
        const hash = v.content_hash;
        let p = pending.get(hash);
        if (!p) {
          p = read(v)
            .catch(() => {})
            .finally(() => pending.delete(hash));
          pending.set(hash, p);
        }
        await p;
      }
    };
    const all = Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deps.waitMs ?? WAIT_MS);
      timer.unref();
    });
    await Promise.race([all, waited]);
    clearTimeout(timer);
  }

  /** A file the index points at (a listing, an icon), kept by its address. */
  const byUrl = (url: string, ext: string) =>
    path.join(dir, "linked", `${createHash("sha256").update(url).digest("hex").slice(0, 32)}${ext}`);
  const readLinked = (url: string, ext: string): Buffer | undefined => {
    try {
      return fs.readFileSync(byUrl(url, ext));
    } catch {
      return undefined;
    }
  };
  const fetchLinked = async (url: string, ext: string, max: number): Promise<Buffer | undefined> => {
    const kept = readLinked(url, ext);
    if (kept) return kept;
    const buf = await fetchSmall(url, max, deps.fetch);
    if (!buf) return undefined;
    fs.mkdirSync(path.dirname(byUrl(url, ext)), { recursive: true });
    fs.writeFileSync(byUrl(url, ext), buf);
    return buf;
  };
  const linkedListing = (url: string | undefined): ListingFile | undefined => {
    const buf = url ? readLinked(url, ".json") : undefined;
    if (!buf) return undefined;
    try {
      return readListing(JSON.parse(buf.toString("utf8")));
    } catch {
      return undefined;
    }
  };

  return {
    /** The index's icon for an entry (an https address), fetched once and kept. */
    async linkedIcon(url: string): Promise<{ mime: string; data: Buffer } | undefined> {
      const ext = /\.svg(\?|$)/i.test(url) ? ".svg" : /\.webp(\?|$)/i.test(url) ? ".webp" : ".png";
      const buf = await fetchLinked(url, ext, 512 * 1024);
      const mime = ext === ".svg" ? "image/svg+xml" : ext === ".webp" ? "image/webp" : "image/png";
      return buf ? { mime, data: buf } : undefined;
    },
    /** An icon or screenshot of a package read before, by its fingerprint and path in it. */
    asset(hash: string, rel: string): Buffer | undefined {
      const base = path.join(dir, hash.replace(/[^0-9a-f]/g, ""));
      const f = path.resolve(base, rel);
      if (!isInside(base, f) || samePath(base, f)) return undefined;
      try {
        return fs.readFileSync(f);
      } catch {
        return undefined;
      }
    },
    /** The catalog's entries at their newest version, with what each brings once its package was read. */
    async entries(listed: Listed[], official: boolean): Promise<CatalogEntry[]> {
      const latest = listed.flatMap((e) => {
        const v = newest(e.versions);
        return v ? [{ e, v }] : [];
      });
      // The listing the index points at, for a package whose own could not be read (yet).
      await Promise.all([
        fill(latest.map((x) => x.v)),
        ...latest.map(({ e }) => (e.listing ? fetchLinked(e.listing, ".json", 256 * 1024) : Promise.resolve())),
      ]);
      return latest.map(({ e, v }) => {
        const pkg = v.content_hash ? known(v.content_hash) : undefined;
        // The package's own listing is the whole page; the catalog's card of it is what there is until it is read.
        const listing = pkg?.listing ?? readListing(v.card) ?? linkedListing(e.listing);
        const isOfficial = official && e.tier === "official";
        const category = categoryOf(e.category) ?? categoryOf(e.categories[0]);
        return {
          id: e.id,
          name: e.name,
          description: e.description,
          categories: e.categories,
          ...(e.tagline ? { tagline: e.tagline } : {}),
          ...(category ? { category } : {}),
          ...(e.icon ? { icon_url: e.icon } : {}),
          version: v.version,
          ...(v.published_at ? { published_at: v.published_at } : {}),
          provenance: isOfficial ? "official" : "third_party",
          ...(v.archive ? { url: v.archive.url } : {}),
          ...(pkg ? { brings: bringsOf(pkg.manifest, listing), needs: needsOf(pkg.manifest, listing) } : {}),
          ...(listing ? { listing: listingCopy(listing, pkg?.manifest, isOfficial) } : {}),
          ...(pkg && v.content_hash ? { contents: contentsOf(pkg.manifest, v.content_hash, pkg.skills) } : {}),
        };
      });
    },
  };
}
