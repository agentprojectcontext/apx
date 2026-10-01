// Secrets by reference. Config and settings hold `secret://<name>` (or `env:<VAR>`); the value is read only by the
// code that uses it, right when it uses it. Values live in <home>/secrets.json (0600) and never leave the core.
import fs from "node:fs";
import path from "node:path";

type Entry = { value: string; updated_at: string };

export type Secrets = ReturnType<typeof createSecrets>;

export function createSecrets(home: string, env: NodeJS.ProcessEnv = process.env) {
  const file = path.join(home, "secrets.json");
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
  return {
    /** Resolves `secret://name` or `env:VAR`; anything else (or a missing value) is undefined. */
    resolve(ref: string | undefined): string | undefined {
      if (!ref) return undefined;
      if (ref.startsWith("env:")) return env[ref.slice(4)] || undefined;
      if (ref.startsWith("secret://")) return read()[ref.slice(9)]?.value || undefined;
      return undefined;
    },
    has(ref: string | undefined): boolean {
      return this.resolve(ref) !== undefined;
    },
    list(): Array<{ name: string; updated_at: string }> {
      return Object.entries(read()).map(([name, e]) => ({ name, updated_at: e.updated_at }));
    },
    set(name: string, value: string | null): void {
      const all = read();
      if (value === null) delete all[name];
      else all[name] = { value, updated_at: new Date().toISOString() };
      write(all);
    },
  };
}
