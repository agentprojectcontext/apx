import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { createEgressProxy } from "./egress-proxy.ts";
import type { LimaRun } from "./lima-process.ts";

/**
 * The guest end of the tunnel: a socket in a folder only the Lima user can write. The proxy's guest port belongs to
 * PID 1 from boot and relays here (security.sh), so no agent can take the port first (DECISIONS.md#d-152).
 */
export const EGRESS_SOCKET = "/run/apx-egress/proxy.sock";

/** The SSH command that forwards the guest's egress socket to the host's public-only proxy. */
export const tunnelArgs = (limaHome: string, instance: string, port: number) => [
  "-F",
  path.join(limaHome, instance, "ssh.config"),
  "-o",
  "ControlMaster=no",
  "-o",
  "ControlPath=none",
  "-o",
  "ControlPersist=no",
  "-N",
  "-T",
  "-o",
  "ExitOnForwardFailure=yes",
  "-o",
  "ServerAliveInterval=5",
  "-o",
  "ServerAliveCountMax=2",
  "-R",
  `${EGRESS_SOCKET}:127.0.0.1:${port}`,
  `lima-${instance}`,
];

/** Reverse forwarding exposes the public-only proxy on guest loopback, never a host/LAN port. */
export function vmEgress(limaHome: string, instance: string, run: LimaRun) {
  let proxy: Awaited<ReturnType<typeof createEgressProxy>> | undefined;
  let tunnel: ChildProcess | undefined;
  let pending: Promise<void> | undefined;
  let closing = false;
  const close = async () => {
    closing = true;
    const child = tunnel;
    tunnel = undefined;
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise<void>((resolve) => {
        const deadline = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2000);
        child.once("close", () => {
          clearTimeout(deadline);
          resolve();
        });
      });
    }
    const current = proxy;
    proxy = undefined;
    await current?.close();
  };
  const connect = async () => {
    if (tunnel && tunnel.exitCode === null && !tunnel.killed && proxy) return;
    if (pending) return pending;
    closing = false;
    pending = (async () => {
      proxy = await createEgressProxy();
      if (closing) {
        await close();
        throw new Error("Computer networking closed");
      }
      // A tunnel that dropped leaves its socket behind, and sshd will not bind over it.
      await run(["shell", instance, "--", "rm", "-f", EGRESS_SOCKET], { timeout: 5000 });
      const child = spawn("/usr/bin/ssh", tunnelArgs(limaHome, instance, proxy.port), {
        stdio: ["ignore", "ignore", "pipe"],
      });
      tunnel = child;
      child.on("error", () => {});
      child.stderr?.resume();
      child.once("close", () => {
        if (tunnel === child) {
          tunnel = undefined;
          void proxy?.close();
          proxy = undefined;
        }
      });
      const deadline = Date.now() + 15_000;
      for (;;) {
        if (closing || child.exitCode !== null || child.killed) throw new Error("Computer network tunnel unavailable");
        try {
          await run(
            [
              "shell",
              instance,
              "--",
              "python3",
              "-c",
              "import socket;s=socket.create_connection(('127.0.0.1',3128),1);s.sendall(b'CONNECT 127.0.0.1:9 HTTP/1.1\\r\\nHost: 127.0.0.1:9\\r\\n\\r\\n');assert s.recv(1024).startswith(b'HTTP/1.1 403');s.close()",
            ],
            { timeout: 2500 },
          );
          return;
        } catch {
          if (Date.now() > deadline) throw new Error("Computer public network proxy did not become ready");
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    })()
      .catch(async (error) => {
        await close();
        throw error;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return { connect, close, ready: () => Boolean(proxy && tunnel && tunnel.exitCode === null && !tunnel.killed) };
}
