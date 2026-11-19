// Where secret values live outside APX's own files, one store per operating system: the login Keychain (macOS), a file
// only the user's Windows account can decrypt (DPAPI, what Credential Manager itself uses) and the desktop keyring
// through the Secret Service (Linux, `secret-tool`). Each runs the system's own command; values go on stdin, never on
// argv. See DECISIONS.md#d-010 and DECISIONS.md#d-133.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type SecretsBackend = "keychain" | "dpapi" | "secret-service" | "file";

/** The store each operating system uses by default. */
export const systemBackend = (platform: NodeJS.Platform = process.platform): SecretsBackend =>
  platform === "darwin" ? "keychain" : platform === "win32" ? "dpapi" : "secret-service";

/** A system command: its stdout, or a throw when it fails or exits non-zero. Injected so tests can fake it. */
export type Run = (
  cmd: string,
  args: string[],
  o?: { input?: string; env?: Record<string, string>; timeoutMs?: number },
) => string;

export const runCommand: Run = (cmd, args, o = {}) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    input: o.input ?? "",
    stdio: ["pipe", "pipe", "ignore"],
    ...(o.env ? { env: { ...process.env, ...o.env } } : {}),
    timeout: o.timeoutMs ?? 15_000,
    windowsHide: true,
  });

export type ValueStore = {
  get(name: string): string | undefined;
  set(name: string, value: string | null): void;
  /** Whether the store answers at all (a keyring daemon, PowerShell); tried once, when nothing was kept there yet. */
  works(): boolean;
};

const SECURITY = "/usr/bin/security";
/** `security -i` cuts each line at about 4 KB: a longer value goes in parts, base64 so nothing needs escaping. */
const LINE_BYTES = 3_500;
const PART_CHARS = 3_000;
const PARTS = "apx-parts:v1:";

export function keychainStore(service: string, run: Run = runCommand): ValueStore {
  const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const read = (name: string) => {
    try {
      return run(SECURITY, ["find-generic-password", "-s", service, "-a", name, "-w"]).replace(/\n$/, "");
    } catch {
      return undefined;
    }
  };
  const remove = (name: string) => {
    try {
      run(SECURITY, ["delete-generic-password", "-s", service, "-a", name]);
    } catch {}
  };
  // Through `security -i` on stdin: a value on argv would show up in the process list.
  const write = (name: string, value: string) =>
    run(SECURITY, ["-i"], { input: `add-generic-password -U -s ${service} -a ${q(name)} -w ${q(value)}\n` });
  const partsOf = (head: string | undefined) => (head?.startsWith(PARTS) ? Number(head.slice(PARTS.length)) || 0 : 0);
  const part = (name: string, i: number) => `${name}#${i}`;
  return {
    get(name) {
      const head = read(name);
      const n = partsOf(head);
      if (!n) return head;
      const parts: string[] = [];
      for (let i = 1; i <= n; i++) {
        const p = read(part(name, i));
        if (p === undefined) return undefined;
        parts.push(p);
      }
      return Buffer.from(parts.join(""), "base64").toString("utf8");
    },
    set(name, value) {
      const before = partsOf(read(name));
      let now = 0;
      if (value === null) remove(name);
      else if (Buffer.byteLength(q(value)) + Buffer.byteLength(q(name)) + service.length < LINE_BYTES)
        write(name, value);
      else {
        const encoded = Buffer.from(value, "utf8").toString("base64");
        now = Math.ceil(encoded.length / PART_CHARS);
        for (let i = 1; i <= now; i++) write(part(name, i), encoded.slice((i - 1) * PART_CHARS, i * PART_CHARS));
        write(name, `${PARTS}${now}`);
      }
      for (let i = now + 1; i <= before; i++) remove(part(name, i));
    },
    works: () => true,
  };
}

/** The Secret Service (GNOME Keyring, KWallet, KeePassXC) through libsecret's `secret-tool`. */
export function secretServiceStore(service: string, run: Run = runCommand): ValueStore {
  const attrs = (name: string) => ["service", service, "account", name];
  const store: ValueStore = {
    get(name) {
      try {
        return run("secret-tool", ["lookup", ...attrs(name)]).replace(/\n$/, "") || undefined;
      } catch {
        return undefined;
      }
    },
    set(name, value) {
      if (value === null) {
        try {
          run("secret-tool", ["clear", ...attrs(name)]);
        } catch {}
        return;
      }
      run("secret-tool", ["store", "--label", `APX ${name}`, ...attrs(name)], { input: value });
    },
    works() {
      // A round trip: a keyring that is missing, or a session bus that is not there, fails here.
      const probe = "apx-store-probe";
      try {
        store.set(probe, "ok");
        const back = store.get(probe);
        store.set(probe, null);
        return back === "ok";
      } catch {
        return false;
      }
    },
  };
  return store;
}

// Windows PowerShell (always present) has .NET's ProtectedData; the operation and entropy come as variables and the
// bytes on stdin, so nothing secret reaches argv.
const DPAPI_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Security",
  "$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
  "$entropy = [Text.Encoding]::UTF8.GetBytes($env:APX_DPAPI_ENTROPY)",
  "$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser",
  "if ($env:APX_DPAPI_OP -eq 'protect') { $out = [Security.Cryptography.ProtectedData]::Protect($data, $entropy, $scope) }",
  "else { $out = [Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, $scope) }",
  "[Console]::Out.Write([Convert]::ToBase64String($out))",
].join("\n");
const ENCODED_SCRIPT = Buffer.from(DPAPI_SCRIPT, "utf16le").toString("base64");

/**
 * Values in `<home>/secrets.dpapi`, encrypted for the user's Windows account (DPAPI, CurrentUser): another account,
 * or the disk read elsewhere, cannot decrypt it. Credential Manager is DPAPI too, but caps a value at 2.5 KB.
 */
export function dpapiStore(home: string, service: string, run: Run = runCommand): ValueStore {
  const file = path.join(home, "secrets.dpapi");
  let values: Record<string, string> | undefined;
  const crypt = (op: "protect" | "unprotect", b64: string) =>
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_SCRIPT], {
      input: b64,
      env: { APX_DPAPI_OP: op, APX_DPAPI_ENTROPY: service },
    }).trim();
  const load = (): Record<string, string> => {
    if (values) return values;
    const loaded = fs.existsSync(file)
      ? (JSON.parse(
          Buffer.from(crypt("unprotect", fs.readFileSync(file, "utf8").trim()), "base64").toString("utf8"),
        ) as Record<string, string>)
      : {};
    values = loaded;
    return loaded;
  };
  const save = (next: Record<string, string>) => {
    const sealed = crypt("protect", Buffer.from(JSON.stringify(next), "utf8").toString("base64"));
    fs.mkdirSync(home, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, sealed, { mode: 0o600 });
    fs.renameSync(tmp, file);
    values = next;
  };
  return {
    get(name) {
      try {
        return load()[name];
      } catch {
        return undefined;
      }
    },
    set(name, value) {
      const next = { ...load() };
      if (value === null) delete next[name];
      else next[name] = value;
      save(next);
    },
    works() {
      try {
        const sample = Buffer.from("ok").toString("base64");
        return Buffer.from(crypt("unprotect", crypt("protect", sample)), "base64").toString("utf8") === "ok";
      } catch {
        return false;
      }
    },
  };
}
