// A client over SSH: the system's own ssh (the owner's keys, agent and ~/.ssh/config) forwards the server's core to
// this computer, so the server never opens a port. The local port equals the remote one: the core only accepts the
// panel from its own origin.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";

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

/** Whether the server has an APX command (to tell "not installed" apart from "not running" and "no login"). */
export function remoteApx(target: string): "installed" | "missing" | "unreachable" {
  const [hostPart, sshPort] = splitTarget(target);
  const r = spawnSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      ...(sshPort ? ["-p", sshPort] : []),
      "--",
      hostPart,
      "command -v apx",
    ],
    { timeout: 20_000, windowsHide: true },
  );
  // ssh itself exits 255 when it cannot log in; anything else is the remote command's own answer.
  if (r.status === 0) return "installed";
  return r.status === 255 || r.status === null ? "unreachable" : "missing";
}
