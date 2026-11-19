// Extensions, the "bundle" step of the extension ladder (DECISIONS.md#d-018): a folder with apx-extension.json that
// brings skills, MCP servers and routine templates, read without running anything. It comes as a folder, an .apxext
// file or an https URL (DECISIONS.md#d-240). Installing copies it into the home and fingerprints it; turning it on
// approves exactly those files. Another version keeps the one before beside it, to go back to.
import fs from "node:fs";
import path from "node:path";
import {
  compareVersions,
  EXTENSION_ARCHIVE_MAX,
  type ExtensionInfo,
  type ExtensionManifest,
  type ExtensionRefusal,
} from "@apx/protocol";
import type { ExtensionRecord, PreviousVersion } from "../domain/extensions.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, CallError, errorMessage, notFound } from "../errors.ts";
import { expandHome, isInside, real, realpath, samePath, tildeHome } from "../paths.ts";
import { extensionSecret as extSecret } from "../secret-names.ts";
import type { Secrets } from "../secrets.ts";
import { addExtensionAgent, addedAgents, archiveExtensionAgents } from "./agents.ts";
import { type Catalog, type CatalogCheck, DownloadError, downloadArchive } from "./catalog.ts";
import { ASSET_MAX, createPackageReader, newest } from "./catalog-packages.ts";
import type { Catalogs } from "./catalogs.ts";
import { writeConnector } from "./connector.ts";
import { createManifestV2, settingsInfo } from "./manifest-v2.ts";
import {
  comparePowers,
  filesOf,
  fingerprint,
  hostsOf,
  legacyFingerprint,
  ownerHost,
  type Package,
  PackageError,
  packArchive,
  readArchive,
  readFolder,
  SECRET_REF,
  SETTING_REF,
  writePackage,
} from "./package.ts";
import type { Plugins } from "./plugins.ts";
import { bringsOf, categoryOf, type ListingFile, listingCopy, needsOf, readListing } from "./summary.ts";

export { extSecret, SECRET_REF, SETTING_REF };

const LISTING = "apx-listing.json";

/** Its manifest names the systems it runs on, and this one is not among them. */
const unsupported = (m: ExtensionManifest) =>
  Boolean(m.platforms?.length && !m.platforms.includes(process.platform as never));
const IMAGE: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

/** Its listing file, when it brings one that reads well. */
function listingIn(read: () => Buffer | undefined): ListingFile | undefined {
  try {
    const buf = read();
    return buf && buf.length < 256 * 1024 ? readListing(JSON.parse(buf.toString("utf8"))) : undefined;
  } catch {
    return undefined;
  }
}

/** Where an extension is read from: exactly one of these (the protocol checks it). */
export type ExtensionInput = {
  path?: string;
  file?: { name: string; data: string };
  url?: string;
  /** An entry of a catalog the owner added. */
  entry?: { catalog: string; id: string };
};

function skillNames(dir: string, m: ExtensionManifest): string[] {
  if (!m.skills) return [];
  try {
    return fs
      .readdirSync(path.resolve(dir, m.skills), { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, m.skills ?? "", e.name, "SKILL.md")))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

const sameFiles = (dir: string, hash: string) => {
  try {
    return fingerprint(dir, filesOf(dir)) === hash;
  } catch {
    return false;
  }
};

export function createExtensions(deps: {
  store: Store;
  secrets: Secrets;
  home: string;
  plugins: Plugins;
  catalog: Catalog;
  /** The catalogs the owner added. */
  catalogs: Catalogs;
  /** Downloads an extension from a URL (a test answers it). */
  fetch?: typeof fetch;
  /** This APX's version, to refuse an extension written for a newer one. */
  version?: string;
}) {
  const { store, secrets, plugins, catalog } = deps;
  const v2 = createManifestV2({ store, secrets });
  const packages = createPackageReader({ home: deps.home, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  const root = path.join(deps.home, "extensions");
  /** The version an update replaced, kept to go back to; ids hold no ".", so this never names another extension. */
  const previousDir = (id: string) => path.join(root, `${id}.prev`);

  type Shown = Pick<
    ExtensionRecord,
    "id" | "manifest" | "hash" | "dir" | "source" | "enabled" | "installed_at" | "provenance" | "settings"
  > & {
    /** Installed: the agents the owner added from it. */
    added_agents?: ExtensionRecord["added_agents"];
    skills?: string[];
    catalog?: CatalogCheck["catalog"];
    update?: ExtensionInfo["update"];
    /** Its listing, already read (an inspected package); otherwise read from its folder. */
    listing?: ListingFile;
  };

  const info = (e: Shown): ExtensionInfo => {
    const listing = e.listing ?? (e.dir ? listingIn(() => fs.readFileSync(path.join(e.dir, LISTING))) : undefined);
    return {
      ...base(e),
      brings: bringsOf(e.manifest, listing),
      needs: needsOf(e.manifest, listing),
      hosts: hostsOf(e.manifest),
      ...(ownerHost(e.manifest) ? { owner_host: true } : {}),
      ...(listing ? { listing: listingCopy(listing, e.manifest, e.provenance === "official") } : {}),
    };
  };
  /** The agents added from it that the owner still has, when there are any. */
  const addedOf = (e: Shown) => {
    const added = e.added_agents ? addedAgents(store, { added_agents: e.added_agents }) : [];
    return added.length ? { added_agents: added } : {};
  };
  const base = (e: Shown): Omit<ExtensionInfo, "brings" | "needs" | "hosts" | "listing"> => ({
    id: e.id,
    name: e.manifest.name,
    version: e.manifest.version,
    description: e.manifest.description,
    enabled: e.enabled,
    hash: e.hash,
    // Shown with "~" for the home; install reads it back.
    source: tildeHome(e.source),
    skills: e.skills ?? skillNames(e.dir, e.manifest),
    mcp: Object.keys(e.manifest.mcp).map((n) => `${e.id}-${n}`),
    routines: e.manifest.routines,
    secrets: e.manifest.secrets.map((s) => ({
      name: s.name,
      label: s.label,
      ...(s.url ? { url: s.url } : {}),
      set: secrets.has(`secret://${extSecret(e.id, s.name)}`),
    })),
    ...(e.manifest.plugin
      ? {
          plugin: {
            observe: e.manifest.plugin.observe,
            context: e.manifest.plugin.context,
            network: e.manifest.plugin.network,
            local_network: e.manifest.plugin.network && e.manifest.plugin.local_network,
            ...plugins.status(e.id),
          },
        }
      : {}),
    runs_code: Boolean(e.manifest.plugin) || Object.values(e.manifest.mcp).some((m) => m.command),
    installed_at: e.installed_at,
    provenance: e.provenance,
    settings: settingsInfo(e, secrets),
    agents: e.manifest.agents,
    ...addedOf(e),
    pages: e.manifest.pages.map((p) => ({ id: p.id, title: p.title })),
    apps: e.manifest.apps,
    ...(e.manifest.companion ? { companion: e.manifest.companion } : {}),
    ...(unsupported(e.manifest) ? { unsupported: true } : {}),
    ...(e.catalog ? { catalog: e.catalog } : {}),
    ...(e.update ? { update: e.update } : {}),
  });
  /** An installed one, with what it adds over the version kept before it. */
  const shown = (e: ExtensionRecord, check?: CatalogCheck): ExtensionInfo =>
    info({
      ...e,
      ...(check?.catalog ? { catalog: check.catalog } : {}),
      ...(e.previous
        ? { update: { from: e.previous.manifest.version, ...comparePowers(e.previous.manifest, e.manifest) } }
        : {}),
    });

  const folder = (p: string) => {
    const dir = path.resolve(expandHome(p));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw notFound(`folder ${p}`);
    if (isInside(root, dir)) throw badRequest("that folder is an installed copy already");
    return realpath(dir);
  };
  const refused = (message: string, detail: ExtensionRefusal) => badRequest(message, detail);
  /** The extension read and checked, and what to call where it came from. Nothing is written. */
  const load = async (input: ExtensionInput): Promise<{ pkg: Package; source: string }> => {
    const read = await readInput(input);
    const min = read.pkg.manifest.min_apx;
    if (min && deps.version && compareVersions(min, deps.version) > 0)
      throw refused(`${read.pkg.manifest.name} needs APX ${min} or newer`, { reason: "newer_apx", needs: min });
    return read;
  };
  const readInput = async (input: ExtensionInput): Promise<{ pkg: Package; source: string }> => {
    try {
      if (input.path !== undefined) {
        const dir = folder(input.path);
        return { pkg: readFolder(dir), source: dir };
      }
      if (input.file) {
        const buf = Buffer.from(input.file.data.replace(/^data:[^,]*,/, ""), "base64");
        if (buf.length > EXTENSION_ARCHIVE_MAX) throw badRequest("the file is too big for an extension");
        return { pkg: readArchive(buf), source: path.basename(input.file.name) };
      }
      if (input.url) return { pkg: readArchive(await downloadArchive(input.url, deps.fetch)), source: input.url };
      if (input.entry) return await deps.catalogs.resolve(input.entry.catalog, input.entry.id);
    } catch (err) {
      // A refused archive or a failed download is the owner's to fix, not APX's failure.
      if (err instanceof CallError || !(err instanceof Error)) throw err;
      if (err instanceof PackageError) throw refused(err.message, { reason: err.reason });
      if (err instanceof DownloadError) throw refused(errorMessage(err, 300), { reason: "download" });
      throw badRequest(errorMessage(err, 300));
    }
    throw badRequest("give a folder, an .apxext file or an https address");
  };
  /** Whether an extension that is on stays on with these files: the same ones, or official asking for nothing more. */
  const keepsOn = (cur: ExtensionRecord | undefined, m: ExtensionManifest, hash: string, check: CatalogCheck) =>
    Boolean(
      cur?.enabled &&
        (cur.hash === hash || (check.provenance === "official" && comparePowers(cur.manifest, m).adds.length === 0)),
    );
  /** Starts its plugin without ever failing APX: a problem is shown as the plugin's error. */
  const startPlugin = (e: ExtensionRecord) => {
    try {
      plugins.start(e);
    } catch (err) {
      plugins.fail(e.id, errorMessage(err, 300));
    }
  };
  const get = (id: string) => {
    const e = store.extensions.get(id);
    if (!e) throw notFound(`extension ${id}`);
    return e;
  };
  /** Only one enabled extension may add context to turns. */
  const contextTaken = (id: string, m: ExtensionManifest) =>
    m.plugin?.context ? store.extensions.enabled().find((x) => x.id !== id && x.manifest.plugin?.context) : undefined;

  return {
    /** The catalogs the owner added. */
    catalogs: deps.catalogs,
    /** The owner's "Test": its plugin asked for context on a sample text, as a turn would ask it. */
    async testContext(
      id: string,
      text: string,
    ): Promise<{ ok: boolean; ms: number; context?: string; error?: string }> {
      const e = get(id);
      if (!e.manifest.plugin?.context) throw badRequest(`${e.manifest.name} adds no context to turns`);
      const st = plugins.status(id);
      if (st.status !== "running")
        return { ok: false, ms: 0, error: st.error ?? "its plugin is not running: turn the extension on" };
      const t0 = Date.now();
      const out = await plugins.ask(id, {
        thread: { id: "test", kind: "loose", title: "Test" },
        agent: { id: "test", name: "Test" },
        text,
      });
      const ms = Date.now() - t0;
      return out ? { ok: true, ms, context: out.slice(0, 4000) } : { ok: false, ms, error: "no answer in time" };
    },
    /** The extension as approved now: enabled and with the files that were turned on. */
    approved(id: string): ExtensionRecord | undefined {
      const e = store.extensions.get(id);
      if (!e?.enabled) return undefined;
      return sameFiles(e.dir, e.hash) ? e : undefined;
    },
    /**
     * At start: an enabled extension whose files changed on disk is turned off. One fingerprinted with "\\" (Windows,
     * before DECISIONS.md#d-240) whose files are unchanged gets the new fingerprint and keeps its on or off.
     */
    verify(): string[] {
      for (const e of store.extensions.list()) {
        if (sameFiles(e.dir, e.hash)) continue;
        try {
          const files = filesOf(e.dir);
          if (legacyFingerprint(e.dir, files) === e.hash) store.extensions.setHash(e.id, fingerprint(e.dir, files));
        } catch {}
      }
      const off: string[] = [];
      for (const e of store.extensions.enabled()) {
        if (!sameFiles(e.dir, e.hash)) {
          store.extensions.setEnabled(e.id, false);
          off.push(e.manifest.name);
        } else startPlugin(e);
      }
      return off;
    },
    list: () => store.extensions.list().map((e) => shown(e)),
    /**
     * One of its listing's images (icon, screenshot), from its installed copy or, not installed, its catalog package
     * read before. Only images, only inside it.
     */
    async asset(id: string, file: string): Promise<{ mime: string; data: string } | undefined> {
      const e = store.extensions.get(id);
      // "@icon": the icon the catalog's index points at, for one whose package was not read.
      if (file === "@icon") {
        const { entries } = await catalog.entries();
        const url = entries.find((x) => x.id === id)?.icon;
        const got = url ? await packages.linkedIcon(url) : undefined;
        return got ? { mime: got.mime, data: got.data.toString("base64") } : undefined;
      }
      const mime = IMAGE[path.extname(file).toLowerCase()];
      if (!mime || file.includes("..") || path.isAbsolute(file)) return undefined;
      let buf: Buffer | undefined;
      if (e) {
        const f = path.resolve(e.dir, file);
        if (isInside(e.dir, f) && fs.existsSync(f) && fs.statSync(f).size <= ASSET_MAX) buf = fs.readFileSync(f);
      } else {
        const { entries } = await catalog.entries();
        const v = newest(entries.find((x) => x.id === id)?.versions ?? []);
        if (v?.content_hash) buf = packages.asset(v.content_hash, file);
      }
      return buf ? { mime, data: buf.toString("base64") } : undefined;
    },
    /** What APX's catalog offers, each with what it brings once its package was read. */
    async catalogEntries(refresh = false) {
      const { entries, catalog: status } = await catalog.entries(refresh);
      // Then the owner's own catalogs: third party, as they list them, filed in APX's categories where theirs maps.
      const added = deps.catalogs.list().flatMap((c) =>
        c.entries.map((e) => {
          const category = categoryOf(e.category);
          return {
            id: e.id,
            name: e.name,
            description: e.description,
            categories: e.category ? [e.category] : [],
            ...(category ? { category } : {}),
            version: e.version,
            provenance: "third_party" as const,
            catalog: c.id,
            catalog_name: c.name,
            ...(e.license ? { license: e.license } : {}),
            ...(e.publisher ? { publisher: e.publisher } : {}),
            ...(e.github ? { github: e.github } : {}),
            ...(e.homepage ? { homepage: e.homepage } : {}),
            ...(e.brings ? { brings: e.brings } : {}),
            ...(e.needs ? { needs: e.needs } : {}),
            ...(e.contents ? { contents: e.contents } : {}),
          };
        }),
      );
      return {
        entries: [...(await packages.entries(entries, true)), ...added],
        ...(status ? { catalog: status } : {}),
      };
    },
    /** A folder packed as an .apxext anyone can install: checked first, and the same extension read back. */
    async pack(dir: string): Promise<{ name: string; data: string; hash: string; size: number }> {
      const { pkg } = await load({ path: dir });
      let buf: Buffer;
      try {
        buf = packArchive(pkg);
      } catch (err) {
        throw badRequest(err instanceof PackageError ? err.message : errorMessage(err, 300));
      }
      if (buf.length > EXTENSION_ARCHIVE_MAX) throw badRequest("the extension is too big for one file");
      const { id, version } = pkg.manifest;
      return { name: `${id}-${version}.apxext`, data: buf.toString("base64"), hash: pkg.hash, size: buf.length };
    },
    /** A server added by its address: the folder of the owner's own connector with that server inside (D-249). */
    connector(server: { name: string; url: string }): string {
      return writeConnector(deps.home, server, (id, dir) => {
        const e = store.extensions.get(id);
        return Boolean(e && !samePath(real(expandHome(e.source)), real(dir)));
      });
    },
    /** What an extension would bring, where it comes from by fingerprint, and what it changes over the installed one. */
    async inspect(input: ExtensionInput): Promise<ExtensionInfo> {
      const { pkg, source } = await load(input);
      const { manifest, hash } = pkg;
      const check = await catalog.check(manifest.id, manifest.version, hash);
      const cur = store.extensions.get(manifest.id);
      return info({
        id: manifest.id,
        manifest,
        settings: cur?.settings ?? {},
        hash,
        dir: "",
        source,
        skills: pkg.skills,
        enabled: Boolean(cur && keepsOn(cur, manifest, hash, check)),
        ...(pkg.files.includes(LISTING) ? { listing: listingIn(() => pkg.read(LISTING)) } : {}),
        installed_at: cur?.installed_at ?? "",
        provenance: check.provenance,
        ...(check.catalog ? { catalog: check.catalog } : {}),
        ...(cur && cur.hash !== hash
          ? {
              update: {
                from: cur.manifest.version,
                ...comparePowers(cur.manifest, manifest),
                keeps_on: keepsOn(cur, manifest, hash, check),
              },
            }
          : {}),
      });
    },
    /**
     * Installs it off (an update of one that is on stays on only when keepsOn says so). A different version moves the
     * installed one aside, to go back to; `expect` refuses files other than the ones the owner looked at.
     */
    async install(input: ExtensionInput, expect?: string): Promise<ExtensionInfo> {
      const { pkg, source } = await load(input);
      const { manifest, hash } = pkg;
      if (expect && expect !== hash)
        throw refused("the extension is not the one you looked at; look at it again", { reason: "changed" });
      const check = await catalog.check(manifest.id, manifest.version, hash);
      const id = manifest.id;
      const dir = path.join(root, id);
      fs.mkdirSync(root, { recursive: true });
      const tmp = fs.mkdtempSync(path.join(root, ".staging-"));
      try {
        const staged = path.join(tmp, id);
        try {
          writePackage(pkg, staged);
        } catch (err) {
          throw badRequest(err instanceof Error ? err.message : "the extension could not be copied");
        }
        const cur = store.extensions.get(id);
        let previous: PreviousVersion | undefined = cur?.previous;
        // The running plugin (if any) is of the files being replaced; it starts again only if allowed to stay on.
        plugins.stop(id);
        if (cur && cur.hash !== hash && fs.existsSync(dir)) {
          fs.rmSync(previousDir(id), { recursive: true, force: true });
          fs.renameSync(dir, previousDir(id));
          previous = {
            manifest: cur.manifest,
            hash: cur.hash,
            source: cur.source,
            provenance: cur.provenance,
            enabled: cur.enabled,
            installed_at: cur.installed_at,
          };
        } else fs.rmSync(dir, { recursive: true, force: true });
        fs.renameSync(staged, dir);
        const e = store.extensions.put({
          id,
          manifest,
          hash,
          dir,
          source,
          provenance: check.provenance,
          previous,
          keepOn: keepsOn(cur, manifest, hash, check) && !contextTaken(id, manifest),
        });
        v2.generate(e);
        if (e.enabled) startPlugin(e);
        return shown(e, check);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
    /** Swaps the installed version with the one kept before it, each with the approval it had. */
    rollback(id: string): ExtensionInfo {
      const e = get(id);
      const prev = e.previous;
      if (!prev) throw badRequest(`${e.manifest.name} has no earlier version kept`);
      const back = previousDir(id);
      if (!fs.existsSync(back) || !sameFiles(back, prev.hash))
        throw badRequest(`the earlier version of ${e.manifest.name} changed on disk; install it again`);
      plugins.stop(id);
      const swap = path.join(root, `${id}.swap`);
      fs.rmSync(swap, { recursive: true, force: true });
      if (fs.existsSync(e.dir)) fs.renameSync(e.dir, swap);
      fs.renameSync(back, e.dir);
      if (fs.existsSync(swap)) fs.renameSync(swap, back);
      const restored = store.extensions.put({
        id,
        manifest: prev.manifest,
        hash: prev.hash,
        dir: e.dir,
        source: prev.source,
        provenance: prev.provenance,
        enabled: prev.enabled && !contextTaken(id, prev.manifest),
        installed_at: prev.installed_at,
        previous: {
          manifest: e.manifest,
          hash: e.hash,
          source: e.source,
          provenance: e.provenance,
          enabled: e.enabled,
          installed_at: e.installed_at,
        },
      });
      if (restored.enabled) startPlugin(restored);
      return shown(restored);
    },
    enable(id: string, enabled: boolean): ExtensionInfo {
      const e = get(id);
      // The copy must still be what was installed.
      if (enabled && !sameFiles(e.dir, e.hash))
        throw badRequest(`${e.manifest.name} changed on disk since it was installed; install it again`);
      if (enabled && unsupported(e.manifest))
        throw badRequest(`${e.manifest.name} does not run on this computer's system`);
      // Any other enabled one counts, running or not: at the next start only one could take the turn context.
      const other = enabled ? contextTaken(id, e.manifest) : undefined;
      if (other) throw badRequest(`${other.manifest.name} already adds context to turns; turn it off first`);
      store.extensions.setEnabled(id, enabled);
      if (enabled) startPlugin(get(id));
      else plugins.stop(id);
      return shown(get(id));
    },
    /** Removes it, and archives the agents the owner added from it (one answering a channel stays). */
    remove(id: string): { removed: boolean; archived: string[]; kept: string[] } {
      const e = store.extensions.get(id);
      if (!e) return { removed: false, archived: [], kept: [] };
      const agents = archiveExtensionAgents(store, e);
      plugins.stop(id);
      for (const s of e.manifest.secrets) secrets.set(extSecret(id, s.name), null);
      store.extensions.remove(id);
      fs.rmSync(e.dir, { recursive: true, force: true });
      fs.rmSync(previousDir(id), { recursive: true, force: true });
      // A later extension with the same id starts clean.
      fs.rmSync(path.join(deps.home, "extension-data", id), { recursive: true, force: true });
      return { removed: true, ...agents };
    },
    /** One of its ready-made agents, added to the owner's team. */
    addAgent: (id: string, agent: string) => addExtensionAgent(store, get(id), agent),
    /** Its settings (manifest 2); a running plugin starts again with them. */
    setSettings(id: string, values: Record<string, string | number | boolean | null>): ExtensionInfo {
      v2.set(get(id), values);
      const e = get(id);
      if (e.enabled && e.manifest.plugin) {
        plugins.stop(id);
        startPlugin(e);
      }
      return shown(e);
    },
    page: (id: string, page: string) => v2.page(get(id), page),
    companionFile: (id: string) => v2.companionFile(get(id)),
    appBundle: (id: string, file: string) => v2.appBundle(get(id), file),
    setSecret(id: string, name: string, value: string | null): ExtensionInfo {
      const e = get(id);
      if (!e.manifest.secrets.some((s) => s.name === name)) throw notFound(`secret ${name} of ${id}`);
      secrets.set(extSecret(id, name), value);
      // A running plugin got its secrets at start.
      if (e.enabled && e.manifest.plugin) {
        plugins.stop(id);
        startPlugin(e);
      }
      return shown(e);
    },
  };
}

export type Extensions = ReturnType<typeof createExtensions>;
