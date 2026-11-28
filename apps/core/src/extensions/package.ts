// An extension's files read from where it comes (a folder, or an .apxext unpacked in memory) without writing or
// running anything: its manifest checked and the fingerprint turning it on approves. Writing goes into an empty
// staging folder only. See DECISIONS.md#d-240
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type ExtensionConnector, ExtensionManifest, type ExtensionPower } from "@apx/protocol";
import { parseFrontmatter, textField } from "../apc/frontmatter.ts";
import { readZip, writeZip } from "../skills/zip.ts";

const MANIFEST = "apx-extension.json";
export const MAX_FILES = 2000;
const MAX_BYTES = 50 * 1024 * 1024;

/** A `secret://name` anywhere in a value (the same names the MCP manager resolves). */
export const SECRET_REF = /secret:\/\/([a-zA-Z0-9_.-]+)/g;
/** A `setting://name`: one of its plain settings, filled in when its server starts. */
export const SETTING_REF = /setting:\/\/([a-zA-Z0-9_]+)/g;

/** A refused extension: the message says what is wrong with it. */
/** Why a package was refused; `newer_apx`: written for an APX newer than this one. */
export class PackageError extends Error {
  readonly reason: "invalid" | "newer_apx";
  constructor(message: string, reason: "invalid" | "newer_apx" = "invalid") {
    super(message);
    this.reason = reason;
  }
}

/** Folders a source leaves out (an installed copy is read whole, so nothing added there goes unnoticed). */
const LEFT_OUT = new Set([".git", "node_modules"]);

/**
 * Every regular file under `root`, relative with "/" and sorted; links and oversized trees are refused. Copying from
 * a source leaves out `.git` and `node_modules`.
 */
export function filesOf(root: string, source = false): string[] {
  const out: string[] = [];
  let bytes = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (source && LEFT_OUT.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      // A source folder reads like its zip would: what a Mac adds is never part of it.
      if (source && junk(e.isDirectory() ? `${rel}/` : rel)) continue;
      if (e.isSymbolicLink()) throw new PackageError(`${rel} is a link; extensions hold plain files`);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        bytes += fs.statSync(abs).size;
        out.push(rel);
        if (out.length > MAX_FILES || bytes > MAX_BYTES) throw new PackageError("the extension is too big");
      }
    }
  };
  walk(root);
  return out.sort();
}

/** The fingerprint over (path, contents) pairs in path order: the catalog's `content_hash` is this same value. */
function fingerprintOf(entries: Iterable<[string, Uint8Array]>): string {
  const h = createHash("sha256");
  for (const [name, data] of entries) h.update(name).update("\0").update(data).update("\0");
  return h.digest("hex").slice(0, 16);
}

export function fingerprint(root: string, files: string[]): string {
  return fingerprintOf(files.map((f) => [f, fs.readFileSync(path.join(root, ...f.split("/")))]));
}

/**
 * The fingerprint as APX computed it before paths used "/" everywhere: on Windows they were joined and sorted with
 * "\\". Only to recognise a record approved then (DECISIONS.md#d-240).
 */
export function legacyFingerprint(root: string, files: string[]): string {
  const names = files.map((f) => f.split("/").join("\\")).sort();
  return fingerprintOf(names.map((n) => [n, fs.readFileSync(path.join(root, ...n.split("\\")))]));
}

/** A path the manifest names, relative to the extension's folder; undefined when it would leave it. */
function inside(rel: string): string | undefined {
  if (path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel)) return undefined;
  const n = path.posix.normalize(rel.replace(/\\/g, "/")).replace(/\/$/, "");
  return n === ".." || n.startsWith("../") ? undefined : n;
}

/** The manifest checked: valid, its paths inside the extension, its secrets declared. `has` says a file exists. */
function checkManifest(text: string | undefined, has: (rel: string) => boolean): ExtensionManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? "");
  } catch {
    throw new PackageError(`no readable ${MANIFEST} at the top of the extension`);
  }
  const parsed = ExtensionManifest.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // A field this APX does not know is one a newer APX added.
    throw new PackageError(
      `${MANIFEST}: ${issue?.message ?? "invalid"}`,
      issue?.code === "unrecognized_keys" ? "newer_apx" : "invalid",
    );
  }
  const m = parsed.data;
  if (new Set(m.events?.map((e) => e.name)).size !== (m.events?.length ?? 0))
    throw new PackageError("event names must be unique");
  if (m.monitor && (!m.events?.length || !m.mcp[m.monitor.server]))
    throw new PackageError("monitor needs declared events and its own MCP server");
  if (m.skills && inside(m.skills) === undefined) throw new PackageError("skills points outside the extension");
  if (m.plugin) {
    const entry = inside(m.plugin.entry);
    if (entry === undefined) throw new PackageError("plugin.entry points outside the extension");
    if (!has(entry)) throw new PackageError(`plugin.entry ${m.plugin.entry} does not exist`);
  }
  checkV2(m, has);
  // A sensitive setting is a secret by another name: both are referenced as secret://name.
  const declared = new Set([
    ...m.secrets.map((s) => s.name),
    ...m.settings.filter((x) => x.sensitive).map((x) => x.name),
  ]);
  const plain = new Set(m.settings.filter((x) => !x.sensitive).map((x) => x.name));
  for (const [name, server] of Object.entries(m.mcp)) {
    if (!server.command && !server.url) throw new PackageError(`mcp ${name} needs a command or a url`);
    const values = [...Object.values(server.env), ...Object.values(server.headers), ...server.args, server.url ?? ""];
    for (const v of values) {
      if (v.startsWith("env:")) throw new PackageError(`mcp ${name}: an extension cannot read APX's environment`);
      // Every reference, also inside text ("Bearer secret://token"), must be one of its own.
      for (const [, ref] of v.matchAll(SECRET_REF))
        if (!declared.has(ref ?? ""))
          throw new PackageError(`mcp ${name}: secret ${ref} is not declared under secrets or sensitive settings`);
      for (const [, ref] of v.matchAll(SETTING_REF))
        if (!plain.has(ref ?? "")) throw new PackageError(`mcp ${name}: setting ${ref} is not declared under settings`);
    }
  }
  if (m.companion?.pairing.with === "extension" && !m.mcp[m.companion.pairing.server])
    throw new PackageError(`companion pairs through mcp ${m.companion.pairing.server}, which it does not bring`);
  return m;
}

/** Manifest 2: unique names, settings that hold together, and every file it names inside it. */
function checkV2(m: ExtensionManifest, has: (rel: string) => boolean): void {
  const unique = (what: string, names: string[]) => {
    const seen = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) throw new PackageError(`${what} ${n} is declared twice`);
      seen.add(n);
    }
  };
  unique("secret or setting", [...m.secrets.map((s) => s.name), ...m.settings.map((s) => s.name)]);
  unique(
    "agent",
    m.agents.map((a) => a.id),
  );
  unique(
    "page",
    m.pages.map((p) => p.id),
  );
  for (const s of m.settings) {
    if (s.fileFormat && s.type !== "file") throw new PackageError(`setting ${s.name}: only a file has a file format`);
    if (s.format && (s.type !== "string" || s.sensitive || s.default !== undefined || s.options || s.generate))
      throw new PackageError(`setting ${s.name}: an HTTPS address must be a plain string without defaults or options`);
    if (
      s.boundTo &&
      (!s.sensitive ||
        s.type !== "string" ||
        s.generate ||
        s.boundTo.some((name) => !m.settings.some((target) => target.name === name && !target.sensitive)))
    )
      throw new PackageError(`setting ${s.name}: boundTo needs a manual sensitive string and declared plain settings`);
    if (s.options && s.type !== "string") throw new PackageError(`setting ${s.name}: only a string has options`);
    if (s.generate && !(s.sensitive && s.type === "string"))
      throw new PackageError(`setting ${s.name}: only a sensitive string is generated`);
    if (
      s.default !== undefined &&
      typeof s.default !== (s.type === "number" ? "number" : s.type === "boolean" ? "boolean" : "string")
    )
      throw new PackageError(`setting ${s.name}: its default is not a ${s.type}`);
  }
  const file = (what: string, rel: string, ext: RegExp) => {
    const p = inside(rel);
    if (p === undefined) throw new PackageError(`${what} points outside the extension`);
    if (!ext.test(p)) throw new PackageError(`${what} ${rel} is not the kind of file it should be`);
    if (!has(p)) throw new PackageError(`${what} ${rel} does not exist`);
  };
  for (const pg of m.pages) file(`page ${pg.id}`, pg.entry, /\.html$/i);
  for (const a of m.apps) file("app", a.file, /\.apxart$/i);
  if (m.companion?.file) file("companion", m.companion.file, /\.(apk|aab|zip|dmg|exe|msi|appimage)$/i);
}

/** Skill folders (each with a SKILL.md) directly under the manifest's `skills`, among the given files. */
function skillsIn(m: ExtensionManifest, files: readonly string[]): string[] {
  const base = m.skills ? inside(m.skills) : undefined;
  if (base === undefined) return [];
  const prefix = base === "." ? "" : `${base}/`;
  const names = new Set<string>();
  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    const parts = f.slice(prefix.length).split("/");
    if (parts.length === 2 && parts[1] === "SKILL.md" && parts[0]) names.add(parts[0]);
  }
  return [...names].sort();
}

/** Each skill's one line (its SKILL.md `description`), by its folder's name; a skill without one is left out. */
function skillLinesOf(m: ExtensionManifest, skills: string[], read: (rel: string) => Buffer): Record<string, string> {
  const base = m.skills ? inside(m.skills) : undefined;
  if (base === undefined) return {};
  const out: Record<string, string> = {};
  for (const name of skills) {
    try {
      const text = read(`${base === "." ? "" : `${base}/`}${name}/SKILL.md`).toString("utf8");
      const line = textField(parseFrontmatter(text).fields.description)?.trim();
      if (line) out[name] = line.slice(0, 300);
    } catch {}
  }
  return out;
}

/** An extension read and checked, ready to show or to write. */
export type Package = {
  manifest: ExtensionManifest;
  hash: string;
  files: string[];
  skills: string[];
  skillLines: Record<string, string>;
  read(rel: string): Buffer;
};

function packageOf(files: string[], read: (rel: string) => Buffer, has: (rel: string) => boolean): Package {
  const text = files.includes(MANIFEST) ? read(MANIFEST).toString("utf8") : undefined;
  const manifest = checkManifest(text, has);
  const skills = skillsIn(manifest, files);
  return {
    manifest,
    hash: fingerprintOf(files.map((f) => [f, read(f)])),
    files,
    skills,
    skillLines: skillLinesOf(manifest, skills, read),
    read,
  };
}

/** Reads a folder, without following links: a file swapped for a link after the listing is refused. */
export function readFolder(dir: string): Package {
  const files = filesOf(dir, true);
  const read = (rel: string) => {
    const fd = fs.openSync(path.join(dir, ...rel.split("/")), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      return fs.readFileSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  };
  const set = new Set(files);
  return packageOf(files, read, (rel) => set.has(rel));
}

/**
 * Left out of a zip as a Mac adds them when zipping a folder (`__MACOSX/`, `.DS_Store`, the `._name` files that carry
 * a file's extended attributes); never part of an extension, and never on the disk it was zipped from.
 */
const junk = (p: string) => {
  const base = p.slice(p.lastIndexOf("/") + 1);
  return p.startsWith("__MACOSX/") || base === ".DS_Store" || base.startsWith("._");
};

/**
 * Unpacks an .apxext (a zip) in memory. Refused whole: links, encrypted entries, paths that leave the folder,
 * sizes that do not match what unpacks, more than 2000 files or 50 MB, and two names one disk would take as one. A
 * single top folder (how zipping a folder by hand packs it) is taken as the extension.
 */
export function readArchive(buf: Buffer): Package {
  let entries: { path: string; data: Buffer }[];
  try {
    // Folders count as entries too: room for them beside the files.
    entries = readZip(buf, { entries: MAX_FILES * 2, bytes: MAX_BYTES, strict: true }).files;
  } catch (err) {
    throw new PackageError(err instanceof Error ? err.message : "not a zip file");
  }
  entries = entries.filter((e) => !junk(e.path));
  const tops = new Set(entries.map((e) => (e.path.includes("/") ? e.path.split("/")[0] : "")));
  const [top] = tops;
  if (tops.size === 1 && top && !entries.some((e) => e.path === MANIFEST))
    entries = entries.map((e) => ({ ...e, path: e.path.slice(top.length + 1) }));
  entries = entries.filter((e) => !e.path.split("/").some((p) => LEFT_OUT.has(p)));
  if (entries.length > MAX_FILES) throw new PackageError("the extension is too big");
  const byPath = new Map<string, Buffer>();
  // On macOS and Windows "A.md" and "a.md" (or two Unicode spellings) are one file; a file and a folder cannot share.
  const folded = new Set<string>();
  const fold = (p: string) => p.normalize("NFC").toLowerCase();
  for (const e of entries) {
    if (folded.has(fold(e.path))) throw new PackageError(`${e.path} is in the archive twice`);
    folded.add(fold(e.path));
    byPath.set(e.path, e.data);
  }
  for (const p of folded) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++)
      if (folded.has(parts.slice(0, i).join("/")))
        throw new PackageError(`${parts.slice(0, i).join("/")} is both a file and a folder`);
  }
  const files = [...byPath.keys()].sort();
  return packageOf(
    files,
    (rel) => byPath.get(rel) ?? Buffer.alloc(0),
    (rel) => byPath.has(rel),
  );
}

/** A package as an .apxext: read back, it must be the same extension (the same fingerprint). */
export function packArchive(pkg: Package): Buffer {
  const buf = writeZip(pkg.files.map((f) => ({ path: f, data: pkg.read(f) })));
  if (readArchive(buf).hash !== pkg.hash) throw new PackageError("the packed file does not read back the same");
  return buf;
}

/** Files already in memory (a converted plugin, a folder read through git), checked like an archive's. */
export function readFiles(all: Map<string, Buffer>): Package {
  const kept = [...all].filter(([p]) => !junk(p) && !p.split("/").some((x) => LEFT_OUT.has(x)));
  if (kept.length > MAX_FILES || kept.reduce((n, [, d]) => n + d.length, 0) > MAX_BYTES)
    throw new PackageError("the extension is too big");
  const byPath = new Map(kept);
  const files = [...byPath.keys()].sort();
  return packageOf(
    files,
    (rel) => byPath.get(rel) ?? Buffer.alloc(0),
    (rel) => byPath.has(rel),
  );
}

/** Writes a package into `dir`, which must not exist yet; its fingerprint read back from disk must match. */
export function writePackage(pkg: Package, dir: string): void {
  fs.mkdirSync(dir);
  for (const f of pkg.files) {
    const target = path.join(dir, ...f.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, pkg.read(f), { flag: "wx" });
  }
  if (fingerprint(dir, filesOf(dir)) !== pkg.hash) throw new PackageError("the extension changed while it was copied");
}

/** What a manifest lets an extension do, to say what another version adds or drops. */
function powersOf(m: ExtensionManifest): ExtensionPower[] {
  const out: ExtensionPower[] = [];
  const hosts = new Set<string>();
  for (const [name, s] of Object.entries(m.mcp)) {
    const detail = s.command ? [s.command, ...s.args].join(" ") : (s.url ?? "");
    out.push({ kind: "mcp", name, detail });
    // An address the owner types is theirs, not a host the extension picked.
    const host = s.url && !OWNER_HOST.test(s.url) ? URL.parse(s.url)?.hostname : undefined;
    if (host) hosts.add(host);
    // A command that bridges to a remote server (`npx mcp-remote https://…`) names where it connects.
    if (s.command)
      for (const a of s.args) {
        const h = /^https:\/\//.test(a) ? URL.parse(a)?.hostname : undefined;
        if (h) hosts.add(h);
      }
  }
  for (const h of m.hosts) hosts.add(h);
  for (const h of [...hosts].sort()) out.push({ kind: "host", name: h });
  // A sensitive setting is a key like a secret: asking for a new one is asking for more.
  for (const s of m.settings.filter((x) => x.sensitive)) out.push({ kind: "secret", name: s.name, detail: s.label });
  for (const s of m.secrets) out.push({ kind: "secret", name: s.name, detail: s.label });
  for (const r of m.routines) out.push({ kind: "routine", name: r.name });
  for (const event of m.events ?? []) out.push({ kind: "event", name: event.name, detail: event.description });
  if (m.monitor)
    out.push({
      kind: "monitor",
      name: `${m.monitor.server}/${m.monitor.tool}`,
      detail: `${m.monitor.every_seconds}s${m.monitor.local_state ? "; local bookkeeping" : ""}`,
    });
  if (m.plugin) {
    out.push({ kind: "plugin", name: m.plugin.entry });
    if (m.plugin.network) out.push({ kind: "internet", name: "internet" });
    if (m.plugin.network && m.plugin.local_network) out.push({ kind: "local_network", name: "local_network" });
    if (m.plugin.context) out.push({ kind: "context", name: "context" });
    for (const ev of m.plugin.observe) out.push({ kind: "observe", name: ev });
  }
  return out;
}

/** The hosts its servers connect to. */
/** A server address whose host is one of its settings (`https://setting://domain/…`). */
const OWNER_HOST = /^https:\/\/(setting|secret):\/\//;
export const ownerHost = (m: ExtensionManifest) => Object.values(m.mcp).some((s) => OWNER_HOST.test(s.url ?? ""));
export const hostsOf = (m: ExtensionManifest) => powersOf(m).flatMap((p) => (p.kind === "host" ? [p.name] : []));

/** The remote server a command bridges to (`npx mcp-remote https://…`), when it names one. */
const bridgedUrl = (args: string[]) => args.find((a) => /^https:\/\//.test(a) && URL.canParse(a));

/** Each server with the address it reaches, to show before it is added; an owner's address is said, not shown. */
export const connectorsOf = (m: ExtensionManifest): ExtensionConnector[] =>
  Object.entries(m.mcp).map(([name, s]) => {
    const owner = Boolean(s.url && OWNER_HOST.test(s.url));
    const url = s.command ? bridgedUrl(s.args) : owner ? undefined : s.url;
    return { name, ...(url ? { url } : {}), ...(owner ? { owner_url: true } : {}), runs_here: Boolean(s.command) };
  });

const key = (p: ExtensionPower) => `${p.kind}\0${p.name}\0${p.detail ?? ""}`;

/**
 * What `next` may do that `prev` could not, and the other way round. A secret's label is not a power: only its name
 * counts. An MCP server whose command or address changed counts as added.
 */
export function comparePowers(
  prev: ExtensionManifest,
  next: ExtensionManifest,
): { adds: ExtensionPower[]; removes: ExtensionPower[] } {
  const k = (p: ExtensionPower) => (p.kind === "secret" ? `${p.kind}\0${p.name}` : key(p));
  const a = powersOf(prev);
  const b = powersOf(next);
  const had = new Set(a.map(k));
  const has = new Set(b.map(k));
  return { adds: b.filter((p) => !had.has(k(p))), removes: a.filter((p) => !has.has(k(p))) };
}
