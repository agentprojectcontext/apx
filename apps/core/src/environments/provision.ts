import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LimaRun } from "./lima-process.ts";
import { agentLoopbackRules, LOOPBACK_RULES } from "./loopback.ts";
import { screenArgs, screenUser, workerArgs } from "./worker.ts";

export const GUEST_ASSETS = path.join(import.meta.dirname, "guest");

const PROXY =
  "Environment=http_proxy=http://127.0.0.1:3128\nEnvironment=https_proxy=http://127.0.0.1:3128\nEnvironment=no_proxy=localhost,127.0.0.1,::1\n";

/** User units every agent's screen user starts with its display number (`apx-desktop@103`). */
export const screenUnits = () => ({
  "apx-desktop@.service": `[Unit]\nDescription=APX screen :%i\n[Service]\nEnvironment=DISPLAY=:%i\n${PROXY}ExecStart=/usr/local/bin/apx-desktop :%i\nRestart=no\n`,
  "apx-agent-terminal@.service": `[Unit]\nDescription=APX agent terminal :%i\n[Service]\nEnvironment=DISPLAY=:%i\nEnvironment=XAUTHORITY=%h/.Xauthority\n${PROXY}ExecStart=/usr/bin/xfce4-terminal --disable-server --title=APX-Agent --geometry=75x16+570+440 --command="tail -n 60 -f %h/work/.apx-terminal.log"\nRestart=no\n`,
});

/** Shared by optional installation and the isolated lab, including every subsequent VM boot. */
export async function provisionDesktop(run: LimaRun, instance: string, signal?: AbortSignal, demo = false) {
  const admin = (args: string[], input?: string | Buffer) => run(["shell", instance, "--", ...args], { input, signal });
  const guest = (args: string[], input?: string | Buffer) => admin(workerArgs(...args), input);
  for (const [source, target] of [
    ["desktop.sh", "apx-desktop"],
    ["apx_vm_session.py", "apx_vm_session.py"],
    ["guest-command.py", "apx-command"],
    ["guest-browser.py", "apx-browser"],
    ["guest-appearance.py", "apx-appearance"],
  ] as const) {
    await admin(["sudo", "tee", `/usr/local/bin/${target}`], fs.readFileSync(path.join(GUEST_ASSETS, source)));
    await admin(["sudo", "chmod", "755", `/usr/local/bin/${target}`]);
  }
  await admin(
    ["sudo", "tee", "/usr/local/libexec/apx-computer-user"],
    fs.readFileSync(path.join(GUEST_ASSETS, "user.sh")),
  );
  await admin(["sudo", "chmod", "755", "/usr/local/libexec/apx-computer-user"]);
  const assets = execFileSync("tar", ["-czf", "-", "-C", path.join(GUEST_ASSETS, "appearance"), "."], {
    maxBuffer: 8 * 1024 * 1024,
  });
  // A shared, root-owned copy each agent's screen user gets its own copy of (user.sh).
  await admin(["sudo", "mkdir", "-p", "/usr/local/share/apx-vm"]);
  await admin(["sudo", "tar", "-xzf", "-", "-C", "/usr/local/share/apx-vm"], assets);
  for (const [name, unit] of Object.entries(screenUnits()))
    await admin(["sudo", "tee", `/etc/systemd/user/${name}`], unit);
  // No screen for the probe user: the lab's sample site is served from its home for the agents' browsers to open.
  if (demo) {
    const unit = `[Unit]\nDescription=APX demo site\n[Service]\nExecStart=/usr/bin/python3 -m http.server 8080 --bind 127.0.0.1 --directory /home/apx-worker/work\nRestart=no\n`;
    await guest(["mkdir", "-p", "/home/apx-worker/work", "/home/apx-worker/.config/systemd/user"]);
    await guest(["tee", "/home/apx-worker/.config/systemd/user/apx-demo-site.service"], unit);
    await guest(["tee", "/home/apx-worker/work/acme.html"], fs.readFileSync(path.join(GUEST_ASSETS, "acme.html")));
    await guest(["systemctl", "--user", "daemon-reload"]);
    await guest(["systemctl", "--user", "start", "apx-demo-site.service"]);
  }
}

/**
 * An agent's screen: its locked user (created once), its own desktop on its display, APX's appearance. Stopping it
 * ends that user's session, so its desktop and browser give their memory back; its home is kept.
 */
export function screenDriver(run: LimaRun, instance: string) {
  const admin = (args: string[], signal?: AbortSignal, timeout?: number) =>
    run(["shell", instance, "--", ...args], { ...(signal ? { signal } : {}), ...(timeout ? { timeout } : {}) });
  return {
    /** `all` is every agent screen there is: the loopback rules are written for all of them at once. */
    async start(screen: number, mode: "light" | "dark", all: number[], signal?: AbortSignal) {
      const u = screenUser(screen);
      const display = u.display.slice(1);
      await admin(["sudo", "-n", "/usr/local/libexec/apx-computer-user", String(screen)], signal, 60_000);
      await run(["shell", instance, "--", "sudo", "-n", "tee", LOOPBACK_RULES], {
        input: agentLoopbackRules([...all, screen]),
        ...(signal ? { signal } : {}),
      });
      await admin(["sudo", "-n", "chmod", "600", LOOPBACK_RULES], signal);
      await admin(["sudo", "-n", "/usr/local/libexec/apx-computer-firewall"], signal, 30_000);
      await admin(screenArgs(screen, "systemctl", "--user", "start", `apx-desktop@${display}.service`), signal);
      await admin(screenArgs(screen, "/usr/local/bin/apx-appearance", mode), signal, 30_000);
      await admin(screenArgs(screen, "systemctl", "--user", "start", `apx-agent-terminal@${display}.service`), signal);
    },
    async appearance(screen: number, mode: "light" | "dark") {
      await admin(screenArgs(screen, "/usr/local/bin/apx-appearance", mode), undefined, 30_000);
    },
    async stop(screen: number) {
      const u = screenUser(screen);
      await admin(["sudo", "-n", "systemctl", "stop", `user@${u.uid}.service`], undefined, 30_000);
      // Its session never comes back by itself: only a new screen starts it again.
      await admin(["sudo", "-n", "loginctl", "disable-linger", u.user], undefined, 10_000);
    },
  };
}
export type ScreenDriver = ReturnType<typeof screenDriver>;
