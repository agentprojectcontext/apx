// Extensions, the "bundle" step of the extension ladder (DECISIONS.md#d-018): a folder with apx-extension.json that
// brings skills, MCP servers and routine templates, read without running anything. Installing copies the folder
// into the home and fingerprints it; turning it on approves exactly those files.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type ExtensionInfo, ExtensionManifest } from "@apx/protocol";
import type { ExtensionRecord } from "../domain/extensions.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import { expandHome, isInside, realpath, tildeHome } from "../paths.ts";
import type { Secrets } from "../secrets.ts";
import type { Plugins } from "./plugins.ts";

export const MANIFEST = "apx-extension.json";
const MAX_FILES = 2000;
const MAX_BYTES = 50 * 1024 * 1024;

/** The name an extension's own secret is stored under. Names have no "-", so `ext-<id>-<name>` cannot be read two ways. */
export const extSecret = (id: string, name: string) => `ext-${id}-${name}`;

/** A `secret://name` anywhere in a value (the same names the MCP manager resolves). */
export const SECRET_REF = /secret:\/\/([a-zA-Z0-9_.-]+)/g;

/**
 * Every regular file under `root`, relative and sorted; links and oversized trees are refused. Copying from a source
 * leaves out `.git` and `node_modules`; an installed copy is read whole, so nothing added there goes unnoticed.
 */
function filesOf(root: string, source = false): string[] {
  const out: string[] = [];
  let bytes = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (source && (e.name === ".git" || e.name === "node_modules")) continue;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) throw badRequest(`${path.relative(root, abs)} is a link; extensions hold plain files`);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        bytes += fs.statSync(abs).size;
        out.push(path.relative(root, abs));
        if (out.length > MAX_FILES || bytes > MAX_BYTES) throw badRequest("the extension is too big");
      }
    }
  };
  walk(root);
  return out.sort();
}

function fingerprint(root: string, files: string[]): string {
  const h = createHash("sha256");
  for (const f of files)
    h.update(f)
      .update("\0")
      .update(fs.readFileSync(path.join(root, f)))
      .update("\0");
  return h.digest("hex").slice(0, 16);
}

/** The manifest of a folder, checked: valid, its paths inside the folder, its secrets declared. */
export function readManifest(dir: string): ExtensionManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"));
  } catch {
    throw badRequest(`no readable ${MANIFEST} in ${dir}`);
  }
  const parsed = ExtensionManifest.safeParse(raw);
  if (!parsed.success) throw badRequest(`${MANIFEST}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  const m = parsed.data;
  if (m.skills && !isInside(dir, path.resolve(dir, m.skills))) throw badRequest("skills points outside the extension");
  if (m.plugin) {
    const entry = path.resolve(dir, m.plugin.entry);
    if (!isInside(dir, entry)) throw badRequest("plugin.entry points outside the extension");
    if (!fs.existsSync(entry)) throw badRequest(`plugin.entry ${m.plugin.entry} does not exist`);
  }
  const declared = new Set(m.secrets.map((s) => s.name));
  for (const [name, server] of Object.entries(m.mcp)) {
    if (!server.command && !server.url) throw badRequest(`mcp ${name} needs a command or a url`);
    const values = [...Object.values(server.env), ...Object.values(server.headers), ...server.args, server.url ?? ""];
    for (const v of values) {
      if (v.startsWith("env:")) throw badRequest(`mcp ${name}: an extension cannot read APX's environment`);
      // Every reference, also inside text ("Bearer secret://token"), must be one of its own.
      for (const [, ref] of v.matchAll(SECRET_REF))
        if (!declared.has(ref ?? "")) throw badRequest(`mcp ${name}: secret ${ref} is not declared under secrets`);
    }
  }
  return m;
}

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

export function createExtensions(deps: { store: Store; secrets: Secrets; home: string; plugins: Plugins }) {
  const { store, secrets, plugins } = deps;
  const root = path.join(deps.home, "extensions");

  const info = (
    e: Pick<ExtensionRecord, "id" | "manifest" | "hash" | "dir" | "source" | "enabled" | "installed_at">,
  ): ExtensionInfo => ({
    id: e.id,
    name: e.manifest.name,
    version: e.manifest.version,
    description: e.manifest.description,
    enabled: e.enabled,
    hash: e.hash,
    // Shown with "~" for the home; install reads it back.
    source: tildeHome(e.source),
    skills: skillNames(e.dir, e.manifest),
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
  });

  const source = (p: string) => {
    const dir = path.resolve(expandHome(p));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw notFound(`folder ${p}`);
    if (isInside(root, dir)) throw badRequest("that folder is an installed copy already");
    return realpath(dir);
  };
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

  return {
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
      try {
        return fingerprint(e.dir, filesOf(e.dir)) === e.hash ? e : undefined;
      } catch {
        return undefined;
      }
    },
    /** At start: an enabled extension whose files changed on disk is turned off. */
    verify(): string[] {
      const off: string[] = [];
      for (const e of store.extensions.enabled()) {
        let same = false;
        try {
          same = fingerprint(e.dir, filesOf(e.dir)) === e.hash;
        } catch {}
        if (!same) {
          store.extensions.setEnabled(e.id, false);
          off.push(e.manifest.name);
        } else startPlugin(e);
      }
      return off;
    },
    list: () => store.extensions.list().map(info),
    inspect(p: string): ExtensionInfo {
      const dir = source(p);
      const manifest = readManifest(dir);
      const hash = fingerprint(dir, filesOf(dir, true));
      const cur = store.extensions.get(manifest.id);
      return info({
        id: manifest.id,
        manifest,
        hash,
        dir,
        source: dir,
        enabled: cur?.hash === hash && cur.enabled,
        installed_at: cur?.installed_at ?? "",
      });
    },
    install(p: string): ExtensionInfo {
      const from = source(p);
      const manifest = readManifest(from);
      const files = filesOf(from, true);
      const dir = path.join(root, manifest.id);
      const staging = `${dir}.new`;
      fs.rmSync(staging, { recursive: true, force: true });
      for (const f of files) {
        fs.mkdirSync(path.dirname(path.join(staging, f)), { recursive: true });
        // Opened without following links: a file swapped for a link after the listing is refused.
        const fd = fs.openSync(path.join(from, f), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          fs.writeFileSync(path.join(staging, f), fs.readFileSync(fd));
        } finally {
          fs.closeSync(fd);
        }
      }
      // The running plugin (if any) is of the files being replaced; it starts again only if they are unchanged.
      plugins.stop(manifest.id);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(staging, dir);
      const e = store.extensions.put({ id: manifest.id, manifest, hash: fingerprint(dir, files), dir, source: from });
      if (e.enabled) startPlugin(e);
      return info(e);
    },
    enable(id: string, enabled: boolean): ExtensionInfo {
      const e = get(id);
      // The copy must still be what was installed.
      if (enabled && fingerprint(e.dir, filesOf(e.dir)) !== e.hash)
        throw badRequest(`${e.manifest.name} changed on disk since it was installed; install it again`);
      if (enabled && e.manifest.plugin?.context) {
        // Any other enabled one counts, running or not: at the next start only one could take the turn context.
        const other = store.extensions.enabled().find((x) => x.id !== id && x.manifest.plugin?.context);
        if (other) throw badRequest(`${other.manifest.name} already adds context to turns; turn it off first`);
      }
      store.extensions.setEnabled(id, enabled);
      if (enabled) startPlugin(get(id));
      else plugins.stop(id);
      return info(get(id));
    },
    remove(id: string): boolean {
      const e = store.extensions.get(id);
      if (!e) return false;
      plugins.stop(id);
      for (const s of e.manifest.secrets) secrets.set(extSecret(id, s.name), null);
      store.extensions.remove(id);
      fs.rmSync(e.dir, { recursive: true, force: true });
      // A later extension with the same id starts clean.
      fs.rmSync(path.join(deps.home, "extension-data", id), { recursive: true, force: true });
      return true;
    },
    setSecret(id: string, name: string, value: string | null): ExtensionInfo {
      const e = get(id);
      if (!e.manifest.secrets.some((s) => s.name === name)) throw notFound(`secret ${name} of ${id}`);
      secrets.set(extSecret(id, name), value);
      // A running plugin got its secrets at start.
      if (e.enabled && e.manifest.plugin) {
        plugins.stop(id);
        startPlugin(e);
      }
      return info(e);
    },
  };
}

export type Extensions = ReturnType<typeof createExtensions>;
