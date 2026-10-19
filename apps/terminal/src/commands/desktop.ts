// Local app installation is shared with the core's web-to-desktop handoff.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RELEASE_FEED } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import { createDesktopInstaller } from "../../../../packages/install/src/desktop.ts";
import { desktopCandidates as candidates, prepareLocalTarget } from "../../../../packages/install/src/paths.ts";
import { apxHome, corePort, coreUp, localConnection } from "./local.ts";

export const desktopCandidates = (platform: string, env: NodeJS.ProcessEnv, home = os.homedir()) =>
  candidates(platform, env, home);

export async function desktop(): Promise<void> {
  const env = { ...process.env };
  const target = await localDesktopTarget(env);
  let phase = "";
  let percent = -1;
  const installer = createDesktopInstaller({
    platform: process.platform,
    arch: process.arch,
    userHome: os.homedir(),
    env,
    feed: env.APX_RELEASES || RELEASE_FEED,
    version: env.APX_INSTALL_VERSION,
    target: () => (target ? prepareLocalTarget(target, localConnection(env).token) : undefined),
    changed: (s) => {
      const next = s.total ? Math.floor((s.received / s.total) * 100) : -1;
      if (s.phase !== phase || next >= percent + 10) {
        console.log(`APX desktop: ${s.phase}${next >= 0 && s.phase === "downloading" ? ` ${next}%` : ""}`);
        phase = s.phase;
        percent = next;
      }
    },
  });
  try {
    installer.start();
    const result = await installer.wait();
    if (result.phase === "failed") throw new Error(result.error || "Desktop installation failed");
    console.log("APX desktop installed and opening");
  } finally {
    await installer.close();
  }
}

/** An answering port is adopted only when it belongs to the selected home. */
export async function localDesktopTarget(env: NodeJS.ProcessEnv) {
  const connection = localConnection(env);
  if (env.APX_URL || !(await coreUp(connection.url))) return undefined;
  const home = apxHome(env);
  const expected = fs.readFileSync(path.join(home, "home-id"), "utf8").trim();
  const health = await new ApxClient({ ...connection, timeoutMs: 2000 }).call("system.health", {});
  if (!expected || health.home_id !== expected)
    throw new Error("The local APX port belongs to another installation. Check APX_HOME and APX_PORT.");
  return { home, port: corePort(env), home_id: expected };
}

export async function openPanel(): Promise<void> {
  const { url } = localConnection();
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore" });
  child.on("error", (error) => console.error(error.message));
  child.unref();
  console.log(`opening ${url}`);
}
