// A client over SSH: the system's own ssh (the owner's keys, agent and ~/.ssh/config) forwards the server's core to
// this computer, so the server never opens a port. The local port equals the remote one: the core only accepts the
// panel from its own origin.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

export type Tunnel = { url: string; stop(): void };

/** ssh's arguments for target "user@host[:port]" forwarding the core's port. */
export function sshArgs(target: string, corePort: number): string[] {
  const [hostPart, sshPort] = splitTarget(target);
  return [
    "-N",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "StrictHostKeyChecking=accept-new",
    ...(sshPort ? ["-p", sshPort] : []),
    "-L",
    `127.0.0.1:${corePort}:127.0.0.1:${corePort}`,
    "--",
    hostPart,
  ];
}

function splitTarget(target: string): [string, string | undefined] {
  const m = /^(.*?)(?::(\d{1,5}))?$/.exec(target.trim());
  return [m?.[1] ?? target, m?.[2]];
}

/** Keeps the forward up (restarted with backoff) until stop(). */
export function startTunnel(target: string, corePort: number, log: (line: string) => void): Tunnel {
  let child: ChildProcess | undefined;
  let stopped = false;
  let backoff = 1000;
  const start = () => {
    const startedAt = Date.now();
    child = spawn("ssh", sshArgs(target, corePort), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    child.stderr?.on("data", (d: Buffer) => log(d.toString().trim()));
    child.on("error", (err) => log(`ssh: ${err.message}`));
    child.on("exit", () => {
      if (stopped) return;
      if (Date.now() - startedAt > 60_000) backoff = 1000;
      setTimeout(start, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    });
  };
  start();
  return {
    url: `http://127.0.0.1:${corePort}`,
    stop() {
      stopped = true;
      child?.kill();
    },
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

/** Whether the server has an APX command (to tell "not installed" apart from "not running" and "no login"). */
export function remoteApx(target: string): "installed" | "missing" | "unreachable" {
  const r = spawnSync("ssh", sshCommand(target, HAS_APX), { timeout: 20_000, windowsHide: true });
  // ssh itself exits 255 when it cannot log in; anything else is the remote command's own answer.
  if (r.status === 0) return "installed";
  return r.status === 255 || r.status === null ? "unreachable" : "missing";
}

export type RemoteInstall =
  | { ok: true; lingers: boolean; user: string }
  | { ok: false; reason: "sshFailed" | "sshUnsupported" | "installFailed"; error?: string };

/** What a server needs before install.sh runs there: Linux or macOS, with bash, curl and tar. */
const PRECHECK =
  'case "$(uname -s 2>/dev/null)" in Linux|Darwin) ;; *) echo "APX_UNSUPPORTED"; exit 3 ;; esac; ' +
  'for c in bash curl tar; do command -v "$c" >/dev/null 2>&1 || { echo "APX_NEEDS $c"; exit 3; }; done';

const LINGER = 'echo "$(id -un) $(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || echo n/a)"';

/** install.sh's options for the server: this app's own version when it is a release, from the same feed. */
export function installArgs(version: string, feed: string | undefined): string[] {
  return [
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
