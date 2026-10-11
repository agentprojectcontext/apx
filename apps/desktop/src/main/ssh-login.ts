// A server that only takes a password: one interactive ssh (its questions go through askpass to the first-run window)
// adds this app's own key to the server's authorized_keys, and every later ssh logs in with that key.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { splitTarget } from "./ssh-tunnel.ts";

/** The app's key pair, made once in its data folder. */
export function appKeyPath(dataDir: string): string {
  return path.join(dataDir, "ssh", "apx_ed25519");
}

/** OpenSSH's version from `ssh -V` ("OpenSSH_9.6p1", "OpenSSH_for_Windows_9.5p1"). */
export function opensshVersion(text: string): [number, number] | undefined {
  const m = /OpenSSH_(?:for_Windows_)?(\d+)\.(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** SSH_ASKPASS_REQUIRE=force (what lets ssh ask here without a terminal) came in OpenSSH 8.4. */
export function askpassSupported(version: [number, number] | undefined): boolean {
  return Boolean(version && (version[0] > 8 || (version[0] === 8 && version[1] >= 4)));
}

export function localSshVersion(): [number, number] | undefined {
  const r = spawnSync("ssh", ["-V"], { timeout: 10_000, windowsHide: true, encoding: "utf8" });
  return opensshVersion(`${r.stderr ?? ""}${r.stdout ?? ""}`);
}

/** The public key line, only when it is one plain ed25519 key (nothing a shell would read as more). */
export function publicKeyLine(text: string): string | undefined {
  const line = text.trim();
  return /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: [A-Za-z0-9._@-]+)?$/.test(line) ? line : undefined;
}

/** Makes the key pair with the system's ssh-keygen the first time; its public line, or undefined when it cannot. */
export function ensureAppKey(dataDir: string): string | undefined {
  const file = appKeyPath(dataDir);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const r = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "apx-desktop", "-f", file], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    });
    if (r.status !== 0) return undefined;
  }
  try {
    return publicKeyLine(fs.readFileSync(`${file}.pub`, "utf8"));
  } catch {
    return undefined;
  }
}

/** The remote command that adds the key once; refuses a key that is not one plain line. */
export function authorizeCommand(pubkey: string): string {
  const key = publicKeyLine(pubkey);
  if (!key || key !== pubkey) throw new Error("not a plain ed25519 public key");
  return (
    "umask 077; mkdir -p ~/.ssh && chmod 700 ~/.ssh && " +
    `{ grep -qxF '${key}' ~/.ssh/authorized_keys 2>/dev/null || echo '${key}' >> ~/.ssh/authorized_keys; } && ` +
    "chmod 600 ~/.ssh/authorized_keys && echo APX_KEY_OK"
  );
}

/** ssh's arguments for the one interactive login: it may ask (host key, password), unlike every other run. */
export function loginArgs(target: string, command: string): string[] {
  const [hostPart, sshPort] = splitTarget(target);
  return [
    "-T",
    "-o",
    "BatchMode=no",
    "-o",
    "StrictHostKeyChecking=ask",
    "-o",
    "ConnectTimeout=15",
    ...(sshPort ? ["-p", sshPort] : []),
    "--",
    hostPart,
    command,
  ];
}

/**
 * Runs the interactive login that authorizes `pubkey`; `env` routes ssh's questions (askpass). `onLine` gets the
 * server's and ssh's output, which never carries what the owner typed. True once the server says the key is in.
 */
export async function authorizeKey(
  target: string,
  pubkey: string,
  env: Record<string, string>,
  onLine: (line: string) => void,
  deadlineMs = 5 * 60_000,
): Promise<boolean> {
  const command = authorizeCommand(pubkey);
  let ok = false;
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn("ssh", loginArgs(target, command), {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill(), deadlineMs);
    const lines = (d: Buffer) => {
      for (const raw of d.toString().split(/\r?\n|\r/)) {
        const line = stripVTControlCharacters(raw).trimEnd();
        if (line === "APX_KEY_OK") ok = true;
        else if (line) onLine(line);
      }
    };
    child.stdout.on("data", lines);
    child.stderr.on("data", lines);
    child.on("error", (err) => onLine(`ssh: ${err.message}`));
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  return code === 0 && ok;
}
