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

type Entry = { value?: string; updated_at: string; hint?: string };

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
    } catch {
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
      return Object.hasOwn(read(), name);
    },
    /** Like resolve, but a project's own value for a `secret://` name comes first. */
    resolveIn(ref: string | undefined, projectId: string | undefined): string | undefined {
      if (projectId && ref?.startsWith("secret://")) {
        const own = api.resolve(`secret://${projectSecretName(projectId, ref.slice(9))}`);
        if (own !== undefined) return own;
      }
      return api.resolve(ref);
    },
    list(): Array<{ name: string; updated_at: string; hint?: string }> {
      return Object.entries(read()).map(([name, e]) => ({
        name,
        updated_at: e.updated_at,
        ...(e.hint ? { hint: e.hint } : {}),
      }));
    },
    set(name: string, value: string | null): void {
      const all = read();
      if (store) {
        store.set(name, value);
        cache.delete(name);
      }
      if (value === null) delete all[name];
      else
        all[name] = {
          ...(store ? {} : { value }),
          updated_at: new Date().toISOString(),
          ...(value.length >= HINT_MIN ? { hint: value.slice(-4) } : {}),
        };
      write(all);
    },
  };

  // Values written by the file backend before a store was used move there once, and the file goes away.
  if (store && fs.existsSync(legacy)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacy, "utf8")) as Record<string, Entry>;
      for (const [name, e] of Object.entries(old)) if (e.value) api.set(name, e.value);
      fs.rmSync(legacy);
    } catch {}
  }
  return api;
}
