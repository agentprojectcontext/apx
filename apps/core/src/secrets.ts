// Secrets by reference. Config and settings hold `secret://<name>` (or `env:<VAR>`); the value is read only by the
// code that uses it, right when it uses it, and never leaves the core.
// On macOS values live in the login Keychain (service "apx2", one per home): an agent harness sandboxed to read the disk
// (Codex read-only) cannot read it. Elsewhere, and in tests, they live in <home>/secrets.json (0600).
// See DECISIONS.md#d-010
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defaultHome } from "./config.ts";

export type SecretsBackend = "keychain" | "file";
type Entry = { value?: string; updated_at: string; hint?: string };

/** Values at least this long keep their last four characters as a hint; shorter ones would give too much away. */
const HINT_MIN = 12;

const SECURITY = "/usr/bin/security";

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

export function createSecrets(home: string, backend: SecretsBackend, env: NodeJS.ProcessEnv = process.env) {
  const SERVICE = keychainService(home);
  // The file holds values only for the file backend; with the Keychain it is just the index (names, dates).
  const file = path.join(home, backend === "keychain" ? "secrets.index.json" : "secrets.json");
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
  const keychainGet = (name: string): string | undefined => {
    try {
      return execFileSync(SECURITY, ["find-generic-password", "-s", SERVICE, "-a", name, "-w"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).replace(/\n$/, "");
    } catch {
      return undefined;
    }
  };
  const keychainSet = (name: string, value: string | null) => {
    if (value === null) {
      try {
        execFileSync(SECURITY, ["delete-generic-password", "-s", SERVICE, "-a", name], { stdio: "ignore" });
      } catch {}
      return;
    }
    // Through `security -i` on stdin: a value on argv would show up in the process list.
    const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    execFileSync(SECURITY, ["-i"], {
      input: `add-generic-password -U -s ${SERVICE} -a ${q(name)} -w ${q(value)}\n`,
      stdio: ["pipe", "ignore", "ignore"],
    });
  };

  const api = {
    backend,
    /** Resolves `secret://name` or `env:VAR`; anything else (or a missing value) is undefined. */
    resolve(ref: string | undefined): string | undefined {
      if (!ref) return undefined;
      if (ref.startsWith("env:")) return env[ref.slice(4)] || undefined;
      if (!ref.startsWith("secret://")) return undefined;
      const name = ref.slice(9);
      if (backend === "file") return read()[name]?.value || undefined;
      if (!cache.has(name)) cache.set(name, keychainGet(name));
      return cache.get(name);
    },
    has(ref: string | undefined): boolean {
      return api.resolve(ref) !== undefined;
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
      if (backend === "keychain") {
        keychainSet(name, value);
        cache.delete(name);
      }
      if (value === null) delete all[name];
      else
        all[name] = {
          ...(backend === "file" ? { value } : {}),
          updated_at: new Date().toISOString(),
          ...(value.length >= HINT_MIN ? { hint: value.slice(-4) } : {}),
        };
      write(all);
    },
  };

  // Values written by the file backend before the Keychain was used move there once, and the file goes away.
  const legacy = path.join(home, "secrets.json");
  if (backend === "keychain" && fs.existsSync(legacy)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacy, "utf8")) as Record<string, Entry>;
      for (const [name, e] of Object.entries(old)) if (e.value) api.set(name, e.value);
      fs.rmSync(legacy);
    } catch {}
  }
  return api;
}
