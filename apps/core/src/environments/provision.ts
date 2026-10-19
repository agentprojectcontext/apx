import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LimaRun } from "./lima-process.ts";
import { workerArgs } from "./worker.ts";

export const GUEST_ASSETS = path.join(import.meta.dirname, "guest");

/** Shared by optional installation and the isolated lab, including every subsequent VM boot. */
export async function provisionDesktop(
  run: LimaRun,
  instance: string,
  mode: "light" | "dark",
  signal?: AbortSignal,
  demo = false,
) {
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
  const appearance = "/home/apx-worker/.local/share/apx-vm";
  await guest(["mkdir", "-p", appearance, "/home/apx-worker/.config/systemd/user"]);
  await guest(
    ["tar", "-xzf", "-", "-C", appearance],
    execFileSync("tar", ["-czf", "-", "-C", path.join(GUEST_ASSETS, "appearance"), "."], {
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
  await guest(["touch", "/home/apx-worker/work/.apx-terminal.log"]);
  const unit = async (name: string, command: string) =>
    guest(
      ["tee", `/home/apx-worker/.config/systemd/user/${name}.service`],
      `[Unit]\nDescription=APX ${name}\n[Service]\nEnvironment=DISPLAY=:1\nEnvironment=http_proxy=http://127.0.0.1:3128\nEnvironment=https_proxy=http://127.0.0.1:3128\nEnvironment=no_proxy=localhost,127.0.0.1,::1\nExecStart=${command}\nRestart=no\n`,
    );
  await unit("apx-desktop", "/usr/local/bin/apx-desktop");
  await unit(
    "apx-agent-terminal",
    '/usr/bin/xfce4-terminal --disable-server --title=APX-Agent --geometry=75x16+570+440 --command="tail -n 60 -f /home/apx-worker/work/.apx-terminal.log"',
  );
  await guest(["systemctl", "--user", "daemon-reload"]);
  await guest(["systemctl", "--user", "start", "apx-desktop.service"]);
  await guest(["/usr/local/bin/apx-appearance", mode]);
  await guest(["systemctl", "--user", "start", "apx-agent-terminal.service"]);
  if (demo) {
    await unit(
      "apx-demo-browser",
      "/usr/bin/chromium --ozone-platform=x11 --disable-gpu --no-first-run --disable-dev-shm-usage --disable-session-crashed-bubble --window-size=1050,730 --window-position=20,30 file:///home/apx-worker/work/acme.html",
    );
    await unit(
      "apx-demo-terminal",
      "/usr/bin/xfce4-terminal --disable-server --title=APX-VM --geometry=75x17+570+400 --working-directory=/home/apx-worker/work",
    );
    await guest(["tee", "/home/apx-worker/work/acme.html"], fs.readFileSync(path.join(GUEST_ASSETS, "acme.html")));
    await unit(
      "apx-demo-site",
      "/usr/bin/python3 -m http.server 8080 --bind 127.0.0.1 --directory /home/apx-worker/work",
    );
    await guest(["systemctl", "--user", "daemon-reload"]);
    await guest(["systemctl", "--user", "start", "apx-demo-site.service"]);
  }
}
