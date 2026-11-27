// Secrets by reference. Config and settings hold `secret://<name>` (or `env:<VAR>`); the value is read only by the
// code that uses it, right when it uses it, and never leaves the core.
// Values live in the system's own store (secrets-stores.ts): the login Keychain on macOS, a DPAPI file on Windows, the
// Secret Service keyring on Linux, so an agent harness sandboxed to read the disk cannot read them. Without one (a Linux
// server with no keyring), and in tests, they live in <home>/secrets.json (0600). See DECISIONS.md#d-010
import fs from "node:fs";
import path from "node:path";
import { defaultHome } from "./config.ts";
import {
  dpapiStore,
  keychainStore,
  type Run,
  runCommand,
  type SecretsBackend,
  secretServiceStore,
  type ValueStore,
} from "./secrets-stores.ts";

export type { SecretsBackend } from "./secrets-stores.ts";

/** Where agents may sign in with a secret, and its last such use (DECISIONS.md#d-193). Kept with the secret. */
export type SecretSite = { origin: string; kind: "password" | "username" | "otp" };
export type SecretUse = { origin: string; at: string; agent?: string };
/** What the owner said a variable is for; a `login` holds a username and a password together (DECISIONS.md#d-264). */
export type SecretField = SecretSite["kind"] | "login";
export type Login = { username: string; password: string };
type Entry = {
  value?: string;
  revoked?: boolean;
  updated_at: string;
  hint?: string;
  field?: SecretField;
  sites?: SecretSite[];
  used?: SecretUse;
};

/** A sign-in's two parts, from its stored value; undefined for anything else. */
export function parseLogin(stored: string | undefined): Login | undefined {
  if (!stored) return undefined;
  try {
    const v = JSON.parse(stored) as Partial<Login>;
    return typeof v.password === "string" ? { username: String(v.username ?? ""), password: v.password } : undefined;
  } catch {
    return undefined;
  }
}

function isBoundCredential(value: string): boolean {
  try {
    return JSON.parse(value)?.format === "apx-bound-secret@1";
  } catch {
    return false;
  }
}

/** Values at least this long keep their last four characters as a hint; shorter ones would give too much away. */
const HINT_MIN = 12;

export type Secrets = ReturnType<typeof createSecrets>;

/**
 * A project's own value for a name: stored apart (a "~" and "/" no public name can hold), it wins over the global one
 * for that project's MCP servers.
 */
export const projectSecretName = (projectId: string, name: string) => `~${projectId}/${name}`;

/** The project and name of a stored key, when it is a project's own. */
export function splitSecretName(key: string): { project_id?: string; name: string } {
  const m = /^~([^/]+)\/(.+)$/.exec(key);
  return m ? { project_id: m[1] as string, name: m[2] as string } : { name: key };
}

/**
 * The Keychain service of a home: "apx2" for the default one (as before it moved into ~/.apx, so its secrets stay
 * found), its own for any other (a test home never overwrites).
 */
export function keychainService(home: string, main = defaultHome()): string {
  const at = path.resolve(home);
  return at === path.resolve(main) ? "apx2" : `apx2:${at}`;
}

export function createSecrets(
  home: string,
  wanted: SecretsBackend,
  env: NodeJS.ProcessEnv = process.env,
  run: Run = runCommand,
) {
  const SERVICE = keychainService(home);
  const index = path.join(home, "secrets.index.json");
  const legacy = path.join(home, "secrets.json");
  const stores: Record<Exclude<SecretsBackend, "file">, () => ValueStore> = {
    keychain: () => keychainStore(SERVICE, run),
    dpapi: () => dpapiStore(home, SERVICE, run),
    "secret-service": () => secretServiceStore(SERVICE, run),
  };
  const candidate = wanted === "file" ? undefined : stores[wanted]();
  // An index means values already went to the store: it stays chosen even while it does not answer (a keyring still
  // locked at boot), or the owner's secrets would seem gone. Otherwise a store that does not work falls back to the file.
  const store =
    candidate && (wanted === "keychain" || fs.existsSync(index) || candidate.works()) ? candidate : undefined;
  const backend: SecretsBackend = store ? wanted : "file";
  // The file holds values only for the file backend; with a store it is just the index (names, dates).
  const file = store ? index : legacy;
  const cache = new Map<string, string | undefined>();
  const read = (): Record<string, Entry> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Entry>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return {};
    }
  };
  const write = (all: Record<string, Entry>) => {
    fs.mkdirSync(home, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };

  const api = {
    backend,
    /** Resolves `secret://name` or `env:VAR`; anything else (or a missing value) is undefined. */
    resolve(ref: string | undefined): string | undefined {
      if (!ref) return undefined;
      if (ref.startsWith("env:")) return env[ref.slice(4)] || undefined;
      if (!ref.startsWith("secret://")) return undefined;
      const name = ref.slice(9);
      if (read()[name]?.revoked) return undefined;
      if (!store) return read()[name]?.value || undefined;
      if (cache.has(name)) return cache.get(name);
      // The Keychain may hold a value from an earlier install in another home; the newer stores only what is listed.
      if (backend !== "keychain" && !Object.hasOwn(read(), name)) return undefined;
      const value = store.get(name);
      // A miss is not kept: a keyring locked now may open later.
      if (value !== undefined || backend === "keychain") cache.set(name, value);
      return value;
    },
    has(ref: string | undefined): boolean {
      return api.resolve(ref) !== undefined;
    },
    /**
     * Whether this install keeps a value under that name (its index). The Keychain may still hold one from an earlier
     * install in another home, which `has` sees and the owner's list does not.
     */
    listed(name: string): boolean {
      const entry = read()[name];
      return entry !== undefined && !entry.revoked;
    },
    /**
     * Like resolve, but a project's own value for a `secret://` name comes first. Given several (a subproject and its
     * parent: domain/projects.ts lineage), the nearest one's own value wins.
     */
    resolveIn(ref: string | undefined, projects: string | readonly string[] | undefined): string | undefined {
      if (ref?.startsWith("secret://"))
        for (const id of typeof projects === "string" ? [projects] : (projects ?? [])) {
          const own = api.resolve(`secret://${projectSecretName(id, ref.slice(9))}`);
          if (own !== undefined) return own;
        }
      return api.resolve(ref);
    },
    list(): Array<{
      name: string;
      updated_at: string;
      hint?: string;
      field?: SecretField;
      sites: SecretSite[];
      last_used?: SecretUse;
    }> {
      const all = read();
      let cleaned = false;
      const listed = Object.entries(all)
        .filter(([, e]) => !e.revoked)
        .map(([name, e]) => {
          let hint = e.hint;
          // JSON-tail hints may belong to a bound envelope; avoid unlocking unrelated keyring entries.
          if (hint?.endsWith('"}')) {
            const value = e.value ?? api.resolve(`secret://${name}`);
            if (value === undefined || isBoundCredential(value)) hint = undefined;
            if (value !== undefined && hint === undefined) {
              delete e.hint;
              cleaned = true;
            }
          }
          return {
            name,
            updated_at: e.updated_at,
            ...(hint ? { hint } : {}),
            ...(e.field ? { field: e.field } : {}),
            sites: e.sites ?? [],
            ...(e.used ? { last_used: e.used } : {}),
          };
        });
      if (cleaned) write(all);
      return listed;
    },
    /** What the owner said it is for, if they did. */
    field(name: string): SecretField | undefined {
      return read()[name]?.field;
    },
    /** Sets what it is for (null: a plain variable); false when no value is stored under that name. */
    setField(name: string, field: SecretField | null): boolean {
      const all = read();
      const e = all[name];
      if (!e || e.revoked) return false;
      if (field) e.field = field;
      else delete e.field;
      write(all);
      return true;
    },
    /** A sign-in's username and password; undefined when the variable is not one. */
    login(name: string): Login | undefined {
      return read()[name]?.field === "login" ? parseLogin(api.resolve(`secret://${name}`)) : undefined;
    },
    /**
     * Stores a sign-in. A part left out keeps the stored one (a new password, the same username); false when nothing
     * gives a password.
     */
    setLogin(name: string, parts: Partial<Login>): boolean {
      const before = api.login(name);
      const password = parts.password ?? before?.password;
      if (!password) return false;
      api.set(name, JSON.stringify({ username: parts.username ?? before?.username ?? "", password }), "login");
      return true;
    },
    /** The sites a stored secret may be used on to sign in; none for a name nobody stored. */
    sites(name: string): SecretSite[] {
      return read()[name]?.sites ?? [];
    },
    /** Sets them; false when no value is stored under that name. */
    setSites(name: string, sites: SecretSite[]): boolean {
      const all = read();
      const e = all[name];
      if (!e || e.revoked) return false;
      if (sites.length) e.sites = sites;
      else delete e.sites;
      write(all);
      return true;
    },
    markUsed(name: string, use: SecretUse): void {
      const all = read();
      const e = all[name];
      if (!e) return;
      e.used = use;
      write(all);
    },
    /**
     * Moves a stored value to another key (a project's own, or the global one), with the sites it may sign in on and
     * its last use; the value stays inside the core. "taken" when the other key already holds one.
     */
    move(from: string, to: string): "moved" | "missing" | "taken" {
      if (from === to) return api.listed(from) ? "moved" : "missing";
      const before = read();
      if (api.listed(to)) return "taken";
      const value = Object.hasOwn(before, from) ? api.resolve(`secret://${from}`) : undefined;
      if (value === undefined) return "missing";
      const { sites, used, field } = before[from] ?? {};
      api.set(to, value, field);
      const all = read();
      const e = all[to];
      if (e && sites) e.sites = sites;
      if (e && used) e.used = used;
      write(all);
      api.set(from, null);
      return "moved";
    },
    /** `field` undefined keeps what it was for; null makes it a plain variable. */
    set(name: string, value: string | null, field?: SecretField | null): void {
      const all = read();
      if (value === null) {
        // A locked keyring may keep the physical value: persist revocation before attempting its deletion.
        all[name] = { revoked: true, updated_at: new Date().toISOString() };
        write(all);
        cache.delete(name);
        store?.set(name, null);
        return;
      }
      if (store) {
        store.set(name, value);
        cache.delete(name);
      }
      {
        // A new value keeps the sites it may sign in on: the owner changed a password, not where it goes.
        const { sites, used, field: was } = all[name] ?? {};
        const kind = field === undefined ? was : (field ?? undefined);
        all[name] = {
          ...(store ? {} : { value }),
          updated_at: new Date().toISOString(),
          // Sign-ins and bound envelopes contain passwords: no part of them is shown.
          ...(value.length >= HINT_MIN && kind !== "login" && !isBoundCredential(value)
            ? { hint: value.slice(-4) }
            : {}),
          ...(kind ? { field: kind } : {}),
          ...(sites ? { sites } : {}),
          ...(used ? { used } : {}),
        };
      }
      write(all);
    },
  };

  // Values written by the file backend before a store was used move there once, and the file goes away.
  if (store && fs.existsSync(legacy)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacy, "utf8")) as Record<string, Entry>;
      for (const [name, e] of Object.entries(old)) if (e.value && !read()[name]?.revoked) api.set(name, e.value);
      fs.rmSync(legacy);
    } catch {}
  }
  return api;
}
