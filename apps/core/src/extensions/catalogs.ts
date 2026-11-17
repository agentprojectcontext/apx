// Catalogs the owner adds for themself: a GitHub `owner/repo`, a git address, an index's https address or a folder.
// APX reads APX's own index format and Claude Code's `.claude-plugin/marketplace.json`; whatever comes from them is
// third party. A plugin whose source is another repository counts only pinned to a commit, and only under a license
// that allows a converted copy; the rest are listed as left out (DECISIONS.md#d-243).
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
import { compareVersions } from "./catalog-packages.ts";
import { convertPlugin, extensionId, licenseOf, pluginLicense } from "./claude-plugin.ts";
import { filesOf, type Package, readArchive, readFiles } from "./package.ts";

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

const sourceText = (s: Source) => (s.kind === "folder" ? s.path : s.url);
const catalogId = (s: Source) => createHash("sha256").update(sourceText(s)).digest("hex").slice(0, 12);

/** owner/repo of a GitHub address, to read a file at a commit. */
const githubRepo = (url: string) =>
  /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)?.slice(1, 3) as [string, string] | undefined;

export function createCatalogs(deps: { store: Store; home: string; git: GitRunner; fetch?: typeof fetch }) {
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

  /** A folder's files as a map (plain files only, `.git` and `node_modules` left out). */
  const folderFiles = (dir: string) =>
    new Map(filesOf(dir, true).map((f) => [f, fs.readFileSync(path.join(dir, ...f.split("/")))]));

  /** A Claude marketplace.json's plugins, each checked: pinned, and under a license that allows converting it. */
  async function readClaude(raw: unknown, root: string | undefined, repoLicense: string | undefined) {
    const entries: CatalogItem[] = [];
    const skipped: CatalogSkip[] = [];
    const plugins = (raw as { plugins?: unknown[] }).plugins ?? [];
    const work = plugins.map(async (p0) => {
      const p = p0 as {
        name?: string;
        displayName?: string;
        description?: string;
        version?: string;
        category?: string;
        homepage?: string;
        source?: unknown;
      };
      const name = p.displayName ?? p.name ?? "";
      if (!p.name) return skipped.push({ name: name || "?", reason: "invalid" });
      const base = {
        id: extensionId(p.name),
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
      if (typeof src === "string") {
        const rel = src.replace(/^\.\//, "");
        const dir = root ? path.resolve(root, rel) : undefined;
        if (!dir || !isInside(root as string, dir) || !fs.existsSync(dir))
          return skipped.push({ name, reason: "source" });
        const license = pluginLicense(folderFiles(dir), repoLicense);
        if (!license) return skipped.push({ name, reason: "license" });
        return entries.push({ ...base, license, via: { type: "path", path: rel } });
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
      return entries.push({ ...base, license, via });
    });
    // A few at a time: each checks a license over the network.
    for (let i = 0; i < work.length; i += 8) await Promise.all(work.slice(i, i + 8));
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
  async function sync(text: string): Promise<CatalogRecord> {
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
      ? await readClaude(raw, root, repoLicense ? fs.readFileSync(repoLicense, "utf8") : undefined)
      : readApx(raw);
    const name =
      (raw as { name?: string; registry?: string }).name ?? (raw as { registry?: string }).registry ?? sourceText(src);
    return store.extensionCatalogs.put({
      id,
      name: String(name).slice(0, 80),
      source: sourceText(src),
      kind: claude ? "claude" : "apx",
      ref: src.kind === "git" ? src.ref : undefined,
      synced_sha: sha,
      synced_at: new Date().toISOString(),
      entries: read.entries,
      skipped: read.skipped,
    });
  }

  return {
    list: () => store.extensionCatalogs.list(),
    add: (text: string) => sync(text),
    sync(id: string): Promise<CatalogRecord> {
      const c = store.extensionCatalogs.get(id);
      if (!c) throw notFound(`catalog ${id}`);
      return sync(c.source);
    },
    remove(id: string): boolean {
      fs.rmSync(repoDir(id), { recursive: true, force: true });
      return store.extensionCatalogs.remove(id);
    },
    /** An entry's files as an extension: its .apxext, or its plugin folder at its commit turned into one. */
    async resolve(catalog: string, entry: string): Promise<{ pkg: Package; source: string }> {
      const c = store.extensionCatalogs.get(catalog);
      const e = c?.entries.find((x) => x.id === entry);
      if (!c || !e) throw notFound(`${entry} in that catalog`);
      const label = `${c.name} · ${e.name}`;
      if (e.via.type === "archive")
        return { pkg: readArchive(await downloadArchive(e.via.url, deps.fetch)), source: label };
      const tmp = e.via.type === "git" ? fs.mkdtempSync(path.join(os.tmpdir(), "apx-plugin-")) : undefined;
      try {
        let dir: string;
        if (e.via.type === "path") {
          const base =
            c.source.startsWith("/") || c.source.startsWith("~")
              ? path.resolve(expandHome(c.source))
              : path.join(repoDir(c.id), "repo");
          dir = path.resolve(base, e.via.path);
          if (!isInside(base, dir)) throw badRequest("that plugin points outside its catalog");
        } else {
          await checkout(e.via.url, tmp as string, { sha: e.via.sha });
          dir = path.resolve(tmp as string, e.via.path ?? ".");
          if (!isInside(tmp as string, dir)) throw badRequest("that plugin points outside its repository");
        }
        const files = folderFiles(dir);
        if (files.has("apx-extension.json")) return { pkg: readFiles(files), source: label };
        const converted = convertPlugin(files, { name: e.name, description: e.description, version: e.version });
        return { pkg: readFiles(converted.files), source: label };
      } finally {
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}

export type Catalogs = ReturnType<typeof createCatalogs>;
