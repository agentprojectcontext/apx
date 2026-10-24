// A client over SSH: the system's own ssh (the owner's keys, agent and ~/.ssh/config) forwards the server's core to
// this computer, so the server never opens a port. The local port equals the remote one: the core only accepts the
// panel from its own origin.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { stripVTControlCharacters } from "node:util";

export type Tunnel = {
  url: string;
  ready: Promise<void>;
  alive(): boolean;
  /** ssh's last complaint (not its debug lines) since it last forwarded, e.g. a refused connection. */
  problem(): string | undefined;
  /** Drops this ssh and starts another at once (a forward that stays up while nothing answers through it). */
  restart(): void;
  stop(): void;
};

let identity: string | undefined;

/** This app's own key (see ssh-login.ts), offered by every ssh run besides the owner's keys and agent. */
export function useIdentity(file: string | undefined): void {
  identity = file;
}

/** `-i <app key>` once the key exists; no IdentitiesOnly, so the owner's own keys keep working. */
export function identityArgs(): string[] {
  return identity && fs.existsSync(identity) ? ["-i", identity] : [];
}

/** ssh's arguments for target "user@host[:port]" forwarding the core's port. */
export function sshArgs(target: string, corePort: number): string[] {
  const [hostPart, sshPort] = splitTarget(target);
  return [
    "-N",
    "-v",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new",
    ...identityArgs(),
    ...(sshPort ? ["-p", sshPort] : []),
    "-L",
    `127.0.0.1:${corePort}:127.0.0.1:${corePort}`,
    "--",
    hostPart,
  ];
}

export function splitTarget(target: string): [string, string | undefined] {
  const m = /^(.*?)(?::(\d{1,5}))?$/.exec(target.trim());
  return [m?.[1] ?? target, m?.[2]];
}

/**
 * Keeps the forward up (restarted with backoff) until stop(). `keepTrying`: a first ssh that fails is retried too (a
 * server still restarting after an update); without it, `ready` rejects (a one-off probe).
 */
export function startTunnel(
  target: string,
  corePort: number,
  log: (line: string) => void,
  changed?: (ready: boolean) => void,
  launch = (args: string[]) => spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }),
  keepTrying = false,
): Tunnel {
  let child: ChildProcess | undefined;
  let stopped = false;
  let forwarding = false;
  let established = false;
  let problem: string | undefined;
  let backoff = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveReady: () => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A tunnel nobody awaits (one that keeps trying) never leaves an unhandled rejection behind.
  ready.catch(() => {});
  const deadline = keepTrying
    ? undefined
    : setTimeout(() => {
        rejectReady(new Error("SSH forwarding did not become ready"));
        stop();
      }, 20_000);
  const start = () => {
    if (stopped) return;
    forwarding = false;
    const startedAt = Date.now();
    let output = "";
    child = launch(sshArgs(target, corePort));
    child.stderr?.on("data", (d: Buffer) => {
      if (stopped) return;
      const text = d.toString();
      log(text.trim());
      output = (output + text).slice(-8192);
      const complaint = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^debug\d:/.test(line) && !/^(OpenSSH|Authenticated to|Transferred:)/.test(line))
        .at(-1);
      if (complaint && !forwarding) problem = complaint.slice(0, 300);
      if (!forwarding && output.includes(`Local forwarding listening on 127.0.0.1 port ${corePort}.`)) {
        forwarding = true;
        established = true;
        problem = undefined;
        clearTimeout(deadline);
        resolveReady();
        changed?.(true);
      }
    });
    child.on("error", (err) => {
      log(`ssh: ${err.message}`);
      problem = `ssh: ${err.message}`;
      if (keepTrying) return;
      rejectReady(new Error(`SSH forwarding failed: ${err.message}`));
      clearTimeout(deadline);
    });
    child.on("exit", () => {
      const wasForwarding = forwarding;
      forwarding = false;
      changed?.(false);
      if (stopped) return;
      if (!wasForwarding && !established && !keepTrying) {
        clearTimeout(deadline);
        rejectReady(new Error(`SSH could not bind local port ${corePort} or connect to the server`));
        return;
      }
      if (Date.now() - startedAt > 60_000) backoff = 1000;
      timer = setTimeout(start, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    });
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    forwarding = false;
    clearTimeout(deadline);
    if (timer) clearTimeout(timer);
    rejectReady(new Error("SSH forwarding stopped"));
    child?.kill();
  };
  start();
  return {
    url: `http://127.0.0.1:${corePort}`,
    ready,
    alive: () => forwarding && !stopped,
    problem: () => (stopped ? undefined : problem),
    restart: () => {
      if (stopped || !child || child.exitCode !== null || child.signalCode !== null) return;
      backoff = 1000;
      child.kill();
    },
    stop,
  };
}

/** ssh's arguments to run one command on target "user@host[:port]" with the owner's keys. */
export function sshCommand(target: string, command: string, connectTimeout = 10): string[] {
  const [hostPart, sshPort] = splitTarget(target);
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${connectTimeout}`,
    "-o",
    "StrictHostKeyChecking=accept-new",
    ...identityArgs(),
    ...(sshPort ? ["-p", sshPort] : []),
    "--",
    hostPart,
    command,
  ];
}

// A command over ssh runs in a non-interactive shell, where ~/.local/bin (install.sh's) is often not on PATH yet;
// and an `apx` on PATH may still be v1's, which is not the APX this app connects to.
const HAS_APX =
  'test -x "$HOME/.local/bin/apx" || case "$(apx --version 2>/dev/null)" in "APX v"[2-9]*) exit 0 ;; *) exit 1 ;; esac';

/**
 * Whether the server has an APX command (to tell "not installed" apart from "not running" and "no login"), and when
 * the login failed, whether the server would take a password instead.
 */
export async function remoteApx(target: string): Promise<"installed" | "missing" | "unreachable" | "password"> {
  const r = await run(sshCommand(target, HAS_APX), 20_000);
  // ssh itself exits 255 when it cannot log in; anything else is the remote command's own answer.
  if (r.status === 0) return "installed";
  if (needsPassword(r.status, r.stderr)) return "password";
  return r.status === 255 || r.status === null ? "unreachable" : "missing";
}

/** One ssh run without blocking the app (the window keeps hearing its steps meanwhile). */
function run(args: string[], timeoutMs: number): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 16_000) stderr += d.toString();
    });
    child.on("error", () => {});
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stderr });
    });
  });
}

/** ssh could not log in, and the server offered a password (or keyboard-interactive) the BatchMode run cannot type. */
export function needsPassword(status: number | null, stderr: string): boolean {
  return status === 255 && /Permission denied \([^)]*\b(password|keyboard-interactive)\b[^)]*\)/.test(stderr);
}

export type RemoteInstall =
  | { ok: true; lingers: boolean; user: string }
  | { ok: false; reason: "sshFailed" | "sshUnsupported" | "installFailed"; error?: string };

/** What a server needs before install.sh runs there: Linux or macOS, with bash, curl and tar. */
const PRECHECK =
  'case "$(uname -s 2>/dev/null)" in Linux|Darwin) ;; *) echo "APX_UNSUPPORTED"; exit 3 ;; esac; ' +
  'for c in bash curl tar; do command -v "$c" >/dev/null 2>&1 || { echo "APX_NEEDS $c"; exit 3; }; done';

const LINGER = 'echo "$(id -un) $(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || echo n/a)"';

/**
 * Turns on linger for the SSH user with sudo, the password on sudo's stdin (never on a command line, never kept).
 * True once the server says the user lingers.
 */
export async function remoteLinger(target: string, password: string): Promise<boolean> {
  const command =
    'sudo -S -p "" loginctl enable-linger "$(id -un)" >/dev/null 2>&1; loginctl show-user "$(id -un)" -p Linger --value';
  const out = await new Promise<string>((resolve) => {
    const child = spawn("ssh", sshCommand(target, command), { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let text = "";
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.on("data", (d: Buffer) => {
      text += d.toString();
    });
    child.on("error", () => resolve(""));
    child.on("close", () => {
      clearTimeout(timer);
      resolve(text);
    });
    child.stdin.end(`${password}\n`);
  });
  return out.trim() === "yes";
}

/** install.sh's options for the server: this app's own version when it is a release, from the same feed. */
export function installArgs(version: string, feed: string | undefined): string[] {
  return [
    "--server",
    ...(/^\d+\.\d+\.\d+$/.test(version) ? ["--version", version] : []),
    ...(feed && /^[\w.:/-]+$/.test(feed) ? ["--feed", feed] : []),
  ];
}

/**
 * Installs the APX daemon on a server over SSH: this app's own install.sh goes in on ssh's stdin (no script is
 * fetched from the network), downloads the release's bundle there and starts it as a service. `onLine` gets its output.
 */
export async function remoteInstall(
  target: string,
  script: string,
  args: string[],
  onLine: (line: string) => void,
  deadlineMs = 10 * 60_000,
): Promise<RemoteInstall> {
  const pre = spawnSync("ssh", sshCommand(target, PRECHECK), { timeout: 30_000, windowsHide: true, encoding: "utf8" });
  if (pre.status === 255 || pre.status === null) return { ok: false, reason: "sshFailed" };
  if (pre.status !== 0) {
    const out = `${pre.stdout ?? ""}`.trim();
    return out.includes("APX_UNSUPPORTED")
      ? { ok: false, reason: "sshUnsupported" }
      : { ok: false, reason: "installFailed", error: out.replace(/^APX_NEEDS /, "missing on the server: ") };
  }
  const tail: string[] = [];
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn("ssh", sshCommand(target, `bash -s -- ${args.join(" ")}`), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill(), deadlineMs);
    const lines = (d: Buffer) => {
      // Colors and progress bars are for a terminal; the window shows plain lines.
      for (const raw of d.toString().split(/\r?\n|\r/)) {
        const line = stripVTControlCharacters(raw).trimEnd();
        if (!line || /^[#\s\d.%]+$/.test(line)) continue;
        tail.push(line);
        if (tail.length > 20) tail.shift();
        onLine(line);
      }
    };
    child.stdout.on("data", lines);
    child.stderr.on("data", lines);
    child.on("error", (err) => onLine(`ssh: ${err.message}`));
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
    child.stdin.end(script);
  });
  if (code === 0) {
    // A Linux user's services stop at their last logout unless they linger (install.sh turns it on when it can).
    const who = spawnSync("ssh", sshCommand(target, LINGER), { timeout: 20_000, windowsHide: true, encoding: "utf8" });
    const [user = "", linger = ""] = `${who.stdout ?? ""}`.trim().split(/\s+/);
    return { ok: true, user, lingers: linger !== "no" };
  }
  if (code === 255) return { ok: false, reason: "sshFailed" };
  return { ok: false, reason: "installFailed", error: tail.slice(-6).join("\n") };
}
