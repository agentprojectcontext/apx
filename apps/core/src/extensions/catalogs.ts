// Catalogs the owner adds for themself: a GitHub `owner/repo`, a git address, an index's https address or a folder.
// APX reads APX's own index format and Claude Code's `.claude-plugin/marketplace.json`; whatever comes from them is
// third party. A plugin whose source is another repository counts only pinned to a commit, and only under a license
// that allows a converted copy; the rest are listed as left out (DECISIONS.md#d-243). What each holds once converted
// is read with the catalog, so it shows as what it is, and one that would bring nothing is left out too (D-253).
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CatalogItem, CatalogRecord, CatalogSkip, CatalogVia } from "../domain/extension-catalogs.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import { expandHome, isInside } from "../paths.ts";
import type { GitRunner } from "../skills/import.ts";
import { downloadArchive, fetchSmall } from "./catalog.ts";
import { catalogPluginIds } from "./catalog-identities.ts";
import { compareVersions } from "./catalog-packages.ts";
import { convertPlugin, extensionId, licenseOf, pluginLicense, pluginVersion } from "./claude-plugin.ts";
import { filesOf, type Package, readArchive, readFiles } from "./package.ts";
import { bringsOf, contentsOf, needsOf } from "./summary.ts";

const GIT_MS = 90_000;
const INDEX_MAX = 5 * 1024 * 1024;
/** License files looked for at a commit, in order. */
const LICENSES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING"];

/** Public catalogs the owner can add with one click. */
export const SUGGESTED = [
  {
    source: "anthropics/knowledge-work-plugins",
    name: "Knowledge Work",
    description: "Anthropic's plugins for productivity, sales, support, finance, legal and more.",
  },
  {
    source: "anthropics/claude-plugins-official",
    name: "Claude plugins",
    description: "Anthropic's directory of plugins for Claude Code.",
  },
];

type Source =
  | { kind: "git"; url: string; ref?: string | undefined }
  | { kind: "json"; url: string }
  | { kind: "folder"; path: string };

/** What the owner typed, as a place APX can read: never anything but https, ssh git or a local folder. */
export function parseSource(text: string): Source {
  const t = text.trim();
  const gh =
    /^(?:https:\/\/github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:\/tree\/([^/]+))?\/?$/.exec(
      t,
    );
  if (gh && !t.startsWith("/") && !t.startsWith("~") && !t.startsWith(".")) {
    return { kind: "git", url: `https://github.com/${gh[1]}/${gh[2]}.git`, ...(gh[3] ? { ref: gh[3] } : {}) };
  }
  if (/^https:\/\/\S+\.json(\?\S*)?$/.test(t)) return { kind: "json", url: t };
  if (/^https:\/\/\S+$/.test(t) || /^ssh:\/\/\w\S*$/.test(t) || /^\w[\w.-]*@\w[\w.-]*:\S+$/.test(t))
    return { kind: "git", url: t };
  if (t.startsWith("/") || t.startsWith("~") || /^[A-Za-z]:[\\/]/.test(t)) return { kind: "folder", path: t };
  throw badRequest("give a GitHub owner/repo, a git address, an https address of an index, or a folder");
}

const sourceText = (s: Source) =>
  s.kind === "folder" ? s.path : s.kind === "git" && s.ref ? `${s.url}/tree/${s.ref}` : s.url;
/** A name for one not read yet: its repository's, file's or folder's (`knowledge-work-plugins`). */
const shortName = (source: string) =>
  source
    .replace(/[/\\]+$/, "")
    .split(/[/\\:]/)
    .at(-1)
    ?.replace(/\.(git|json)$/, "") || source;
const catalogId = (s: Source) => createHash("sha256").update(sourceText(s)).digest("hex").slice(0, 12);

/** A name a catalog gives (a string, or an object with `name`), short and trimmed. */
const nameOf = (v: unknown): string | undefined => {
  const n = typeof v === "string" ? v : v && typeof v === "object" ? (v as { name?: unknown }).name : undefined;
  return typeof n === "string" && n.trim() ? n.trim().slice(0, 80) : undefined;
};

/** owner/repo of a GitHub address, to read a file at a commit. */
const githubRepo = (url: string) =>
  /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)?.slice(1, 3) as [string, string] | undefined;

/** The fields a plugin is converted with: the catalog's, as installing it uses them. */
type PluginBase = { id: string; name: string; description: string; version: string };

/**
 * What a plugin's files hold once converted, as the Marketplace shows it before it is added; `empty` when it would
 * bring nothing APX uses. Undefined when its files do not read as an extension (installing it says why).
 */
function summarizePlugin(files: Map<string, Buffer>, base: PluginBase) {
  try {
    const native = files.has("apx-extension.json");
    const pkg = readFiles(native ? files : convertPlugin(files, base).files);
    const m = pkg.manifest;
    const contents = contentsOf(m, pkg.hash, { names: pkg.skills, lines: pkg.skillLines });
    return {
      contents,
      brings: bringsOf(m),
      needs: needsOf(m),
      empty: !native && !contents.servers && !pkg.skills.length && !contents.agents.length,
    };
  } catch {
    return undefined;
  }
}

/** How far along a catalog being read is: entries checked of how many (0 of 0 while it downloads). */
export type CatalogReading = { done: number; total: number };

/** An added catalog as the owner sees it: what it lists, and whether it is being read or its last read failed. */
export type CatalogShown = CatalogRecord & { reading?: CatalogReading | undefined; failed?: string | undefined };

export function createCatalogs(deps: {
  store: Store;
  home: string;
  git: GitRunner;
  fetch?: typeof fetch;
  /** A catalog being read got further along. */
  onReading?(id: string, at: CatalogReading): void;
  /** A catalog finished being read, or failed. */
  onRead?(id: string): void;
}) {
  const { store, git } = deps;
  const repoDir = (id: string) => path.join(deps.home, "marketplace", "catalogs", id);
  /** Git with only https and ssh, no links checked out, never a prompt. */
  const run = async (args: string[], cwd?: string) => {
    const r = await git(
      [
        ...(cwd ? ["-C", cwd] : []),
        ...[
          "-c",
          "protocol.allow=never",
          "-c",
          "protocol.https.allow=always",
          "-c",
          "protocol.ssh.allow=always",
          "-c",
          "core.symlinks=false",
        ],
        ...args,
      ],
      GIT_MS,
    );
    if (r.code !== 0) throw badRequest(`git: ${r.out.trim().split("\n").at(-1) ?? "failed"}`);
    return r.out.trim();
  };
  /** A repository at a commit (or its default branch's newest), into an empty folder. */
  const checkout = async (url: string, dir: string, at?: { sha?: string; ref?: string }) => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await run(["init", "-q"], dir);
    await run(["remote", "add", "origin", url], dir);
    await run(["fetch", "-q", "--depth", "1", "origin", at?.sha ?? at?.ref ?? "HEAD"], dir);
    await run(["checkout", "-q", "FETCH_HEAD"], dir);
    return run(["rev-parse", "HEAD"], dir);
  };
  /** A file of a GitHub repository at a commit, without cloning it. */
  const rawFile = (url: string, sha: string, rel: string) => {
    const r = githubRepo(url);
    return r
      ? fetchSmall(`https://raw.githubusercontent.com/${r[0]}/${r[1]}/${sha}/${rel}`, 512 * 1024, deps.fetch)
      : undefined;
  };
  /** The license at a commit: the plugin folder's own, else the repository's. */
  const remoteLicense = async (url: string, sha: string, sub?: string) => {
    for (const base of sub ? [`${sub.replace(/\/$/, "")}/`, ""] : [""])
      for (const f of LICENSES) {
        const got = await rawFile(url, sha, `${base}${f}`);
        if (got) return licenseOf(got.toString("utf8"));
      }
    return undefined;
  };
  /**
   * What a plugin of another repository brings, from its `.mcp.json` and plugin.json at its commit: whether it brings
   * MCP servers. Its skills and agents would need its whole tree, so they stay unknown until it is added.
   */
  const remoteBrings = async (url: string, sha: string, base: PluginBase, sub?: string) => {
    const dir = sub ? `${sub.replace(/\/$/, "")}/` : "";
    const files = new Map<string, Buffer>();
    const get = async (rel: string) => {
      const got = await rawFile(url, sha, `${dir}${rel}`);
      if (got) files.set(rel, got);
    };
    await Promise.all([get(".mcp.json"), get(".claude-plugin/plugin.json")]);
    // plugin.json may name the file its servers are in.
    let named: unknown;
    try {
      named = JSON.parse(files.get(".claude-plugin/plugin.json")?.toString("utf8") ?? "{}").mcpServers;
    } catch {}
    const refs = (typeof named === "string" ? [named] : Array.isArray(named) ? named : []).filter(
      (r): r is string => typeof r === "string" && !r.includes(".."),
    );
    await Promise.all(refs.slice(0, 3).map((r) => get(r.replace(/^\.\//, ""))));
    const read = summarizePlugin(files, base);
    return read?.contents.servers ? { brings: read.brings, needs: read.needs } : {};
  };

  /** A folder's files as a map (plain files only, `.git` and `node_modules` left out). */
  const folderFiles = (dir: string) =>
    new Map(filesOf(dir, true).map((f) => [f, fs.readFileSync(path.join(dir, ...f.split("/")))]));

  /** A Claude marketplace.json's plugins, each checked: pinned, and under a license that allows converting it. */
  async function readClaude(
    raw: unknown,
    root: string | undefined,
    repoLicense: string | undefined,
    progress: (done: number, total: number) => void,
    previous: CatalogItem[],
  ) {
    const entries: CatalogItem[] = [];
    const skipped: CatalogSkip[] = [];
    const plugins = (raw as { plugins?: unknown[] }).plugins ?? [];
    const owner = nameOf((raw as { owner?: unknown }).owner);
    const ids = catalogPluginIds(plugins, previous);
    const one = async (p0: unknown, index: number) => {
      const p = p0 as {
        name?: string;
        displayName?: string;
        description?: string;
        version?: string;
        category?: string;
        homepage?: string;
        author?: unknown;
        source?: unknown;
      };
      const name = p.displayName ?? p.name ?? "";
      if (!p.name) return skipped.push({ name: name || "?", reason: "invalid" });
      const base = {
        id: ids.get(index) ?? extensionId(p.name),
        name,
        description: (p.description ?? "").slice(0, 500),
        version: p.version ?? "0.0.0",
        ...(p.category ? { category: p.category } : {}),
        ...(p.homepage ? { homepage: p.homepage } : {}),
        plugin: true,
      };
      const src = p.source as
        | { source?: string; url?: string; repo?: string; path?: string; ref?: string; sha?: string }
        | string
        | undefined;
      // Who makes it: its author; else the catalog's owner for a plugin kept in the catalog's own repository.
      const author = nameOf(p.author);
      if (typeof src === "string") {
        const rel = src.replace(/^\.\//, "");
        const dir = root ? path.resolve(root, rel) : undefined;
        if (!dir || !isInside(root as string, dir) || !fs.existsSync(dir))
          return skipped.push({ name, reason: "source" });
        const files = folderFiles(dir);
        const license = pluginLicense(files, repoLicense);
        if (!license) return skipped.push({ name, reason: "license" });
        const version = p.version ?? pluginVersion(files);
        const by = author ?? owner;
        const read = summarizePlugin(files, { ...base, version: version ?? base.version });
        if (read?.empty) return skipped.push({ name, reason: "empty" });
        return entries.push({
          ...base,
          ...(version ? { version } : {}),
          ...(by ? { publisher: by } : {}),
          license,
          via: { type: "path", path: rel },
          ...(read ? { contents: read.contents, brings: read.brings, needs: read.needs } : {}),
        });
      }
      const url = src?.source === "github" && src.repo ? `https://github.com/${src.repo}.git` : src?.url;
      if (!url || !/^https:\/\//.test(url)) return skipped.push({ name, reason: "source" });
      if (!src?.sha || !/^[0-9a-f]{40}$/.test(src.sha)) return skipped.push({ name, reason: "unpinned" });
      const license = await remoteLicense(url, src.sha, src.source === "git-subdir" ? src.path : undefined);
      if (!license) return skipped.push({ name, reason: "license" });
      const via: CatalogVia = {
        type: "git",
        url,
        sha: src.sha,
        ...(src.source === "git-subdir" && src.path ? { path: src.path } : {}),
      };
      // One from another repository nobody names is told by the GitHub account it lives under.
      const account = githubRepo(url)?.[0];
      return entries.push({
        ...base,
        ...(author ? { publisher: author } : account ? { github: account } : {}),
        license,
        via,
        ...(await remoteBrings(url, src.sha, base, via.path)),
      });
    };
    // A few at a time: each checks a license over the network.
    progress(0, plugins.length);
    for (let i = 0; i < plugins.length; i += 8) {
      await Promise.all(plugins.slice(i, i + 8).map((p, offset) => one(p, i + offset)));
      progress(Math.min(i + 8, plugins.length), plugins.length);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { entries, skipped };
  }

  /** APX's index format: each extension at its newest version, from its packed .apxext. */
  function readApx(raw: unknown) {
    const entries: CatalogItem[] = [];
    for (const e0 of (raw as { entries?: unknown[] }).entries ?? []) {
      const e = e0 as {
        id?: string;
        kind?: string;
        name?: string;
        description?: string;
        versions?: Array<{ version?: string; yanked?: string; archive?: { url?: string; sha256?: string } }>;
      };
      if (!e.id || (e.kind ?? "extension") !== "extension") continue;
      const v = (e.versions ?? [])
        .filter((x) => x.version && !x.yanked && x.archive?.url?.startsWith("https://"))
        .sort((a, b) => compareVersions(b.version ?? "", a.version ?? ""))[0];
      if (!v?.archive?.url) continue;
      entries.push({
        id: e.id,
        name: e.name ?? e.id,
        description: (e.description ?? "").slice(0, 500),
        version: v.version ?? "0.0.0",
        plugin: false,
        via: { type: "archive", url: v.archive.url, ...(v.archive.sha256 ? { sha256: v.archive.sha256 } : {}) },
      });
    }
    return { entries, skipped: [] as CatalogSkip[] };
  }

  const readJson = (file: string) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    } catch {
      return undefined;
    }
  };

  /** Reads a catalog where it is now; its repository is kept in the home to install its folders from. */
  async function sync(
    text: string,
    progress: (done: number, total: number) => void,
  ): Promise<Omit<CatalogRecord, "created_at">> {
    const src = parseSource(text);
    const id = catalogId(src);
    let root: string | undefined;
    let sha: string | undefined;
    let raw: unknown;
    if (src.kind === "json") {
      const buf = await fetchSmall(src.url, INDEX_MAX, deps.fetch);
      if (!buf) throw badRequest(`could not read ${src.url}`);
      raw = JSON.parse(buf.toString("utf8"));
    } else {
      if (src.kind === "git") {
        root = path.join(repoDir(id), "repo");
        sha = await checkout(src.url, root, src.ref ? { ref: src.ref } : undefined);
      } else {
        root = path.resolve(expandHome(src.path));
        if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw notFound(`folder ${src.path}`);
      }
      raw = readJson(path.join(root, ".claude-plugin", "marketplace.json")) ?? readJson(path.join(root, "index.json"));
    }
    if (!raw || typeof raw !== "object")
      throw badRequest("no catalog there: neither a .claude-plugin/marketplace.json nor an index.json");
    const claude = Array.isArray((raw as { plugins?: unknown }).plugins);
    const repoLicense = root
      ? LICENSES.map((f) => path.join(root as string, f)).find((f) => fs.existsSync(f))
      : undefined;
    const read = claude
      ? await readClaude(
          raw,
          root,
          repoLicense ? fs.readFileSync(repoLicense, "utf8") : undefined,
          progress,
          store.extensionCatalogs.get(id)?.entries ?? [],
        )
      : readApx(raw);
    const name =
      (raw as { name?: string; registry?: string }).name ?? (raw as { registry?: string }).registry ?? sourceText(src);
    return {
      id,
      name: String(name).slice(0, 80),
      source: sourceText(src),
      kind: claude ? "claude" : "apx",
      ref: src.kind === "git" ? src.ref : undefined,
      synced_sha: sha,
      synced_at: new Date().toISOString(),
      entries: read.entries,
      skipped: read.skipped,
    };
  }

  type Job = { source: string; at: CatalogReading; done: Promise<CatalogRecord>; shown: boolean; removed: boolean };
  /** Catalogs being read now, by id; one read at a time each, whoever asked for it. */
  const reading = new Map<string, Job>();
  /** Why the last read the owner watched failed, by id, until it is read again or removed. */
  const failed = new Map<string, { source: string; error: string }>();

  /** Starts reading a catalog, or joins the read already going. A bad address is refused right away. */
  function start(text: string, shown: boolean): { id: string; job: Job } {
    const src = parseSource(text);
    const id = catalogId(src);
    const existing = store.extensionCatalogs.get(id);
    if (existing?.ref) {
      const saved = parseSource(existing.source);
      if (saved.kind !== "git" || saved.ref !== existing.ref)
        throw badRequest("remove the old branch catalog and add it again with its branch");
    }
    const going = reading.get(id);
    if (going && !going.removed) {
      going.shown ||= shown;
      return { id, job: going };
    }
    failed.delete(id);
    const state = { source: sourceText(src), at: { done: 0, total: 0 }, shown, removed: false };
    // One removed while it was read finishes first: both would write the same folder.
    const done = (going ? going.done.catch(() => undefined) : Promise.resolve())
      .then(() =>
        sync(text, (n, total) => {
          state.at = { done: n, total };
          deps.onReading?.(id, state.at);
        }),
      )
      .then((c) => {
        // Removed while it was read: nothing of it stays.
        if (state.removed) {
          fs.rmSync(repoDir(id), { recursive: true, force: true });
          throw notFound(`catalog ${id}`);
        }
        return store.extensionCatalogs.put(c);
      })
      .catch((e: unknown) => {
        if (state.shown && !state.removed)
          failed.set(id, { source: state.source, error: e instanceof Error ? e.message : String(e) });
        throw e;
      })
      .finally(() => {
        if (reading.get(id) === job) reading.delete(id);
        deps.onRead?.(id);
      });
    // Whoever only watches hears of a failure through the list, not as an unhandled rejection.
    done.catch(() => {});
    const job: Job = Object.assign(state, { done });
    reading.set(id, job);
    return { id, job };
  }

  /** What the owner sees of one: stored, being read for the first time, or whose first read failed. */
  function shownOf(id: string): CatalogShown | undefined {
    const c = store.extensionCatalogs.get(id);
    const going = reading.get(id);
    const job = going?.removed ? undefined : going;
    const fail = failed.get(id);
    const source = c?.source ?? job?.source ?? fail?.source;
    if (!source) return undefined;
    return {
      ...(c ?? {
        id,
        name: shortName(source),
        source,
        kind: "apx",
        ref: undefined,
        synced_sha: undefined,
        synced_at: undefined,
        entries: [],
        skipped: [],
        created_at: "",
      }),
      ...(job ? { reading: job.at } : {}),
      ...(fail ? { failed: fail.error } : {}),
    };
  }

  /** Reads one: waits for it, or (`background`) answers at once with it being read. */
  async function read(text: string, background: boolean): Promise<CatalogShown> {
    const { id, job } = start(text, background);
    if (background) return shownOf(id) as CatalogShown;
    await job.done;
    return shownOf(id) as CatalogShown;
  }

  return {
    /** The added ones, then any being read for the first time or whose first read failed. */
    list(): CatalogShown[] {
      const stored = store.extensionCatalogs.list();
      const ids = [...stored.map((c) => c.id), ...reading.keys(), ...failed.keys()];
      // shownOf leaves out one removed while it is still being read.
      return [...new Set(ids)].map(shownOf).filter((c): c is CatalogShown => Boolean(c));
    },
    add: (text: string, background = false) => read(text, background),
    sync(id: string, background = false): Promise<CatalogShown> {
      const source = store.extensionCatalogs.get(id)?.source ?? failed.get(id)?.source;
      if (!source) throw notFound(`catalog ${id}`);
      return read(source, background);
    },
    remove(id: string): boolean {
      const job = reading.get(id);
      if (job) job.removed = true;
      const wasFailed = failed.delete(id);
      fs.rmSync(repoDir(id), { recursive: true, force: true });
      return store.extensionCatalogs.remove(id) || wasFailed || Boolean(job);
    },
    /** An entry's files as an extension: its .apxext, or its plugin folder at its commit turned into one. */
    async resolve(catalog: string, entry: string): Promise<{ pkg: Package; source: string; origin: string }> {
      const c = store.extensionCatalogs.get(catalog);
      const e = c?.entries.find((x) => x.id === entry);
      if (!c || !e) throw notFound(`${entry} in that catalog`);
      const label = `${c.name} · ${e.name}`;
      const via =
        e.via.type === "path"
          ? ["path", e.via.path]
          : e.via.type === "git"
            ? ["git", e.via.url, e.via.path ?? ""]
            : ["archive", e.via.url];
      const origin = `catalog-v2:${JSON.stringify([catalog, entry, via])}`;
      if (e.via.type === "archive")
        return { pkg: readArchive(await downloadArchive(e.via.url, deps.fetch)), source: label, origin };
      const tmp = e.via.type === "git" ? fs.mkdtempSync(path.join(os.tmpdir(), "apx-plugin-")) : undefined;
      try {
        let dir: string;
        if (e.via.type === "path") {
          const from = parseSource(c.source);
          const base = from.kind === "folder" ? path.resolve(expandHome(from.path)) : path.join(repoDir(c.id), "repo");
          dir = path.resolve(base, e.via.path);
          if (!isInside(base, dir)) throw badRequest("that plugin points outside its catalog");
        } else {
          await checkout(e.via.url, tmp as string, { sha: e.via.sha });
          dir = path.resolve(tmp as string, e.via.path ?? ".");
          if (!isInside(tmp as string, dir)) throw badRequest("that plugin points outside its repository");
        }
        const files = folderFiles(dir);
        if (files.has("apx-extension.json")) return { pkg: readFiles(files), source: label, origin };
        const converted = convertPlugin(files, {
          id: e.id,
          name: e.name,
          description: e.description,
          version: e.version,
        });
        return { pkg: readFiles(converted.files), source: label, origin };
      } finally {
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}

export type Catalogs = ReturnType<typeof createCatalogs>;
