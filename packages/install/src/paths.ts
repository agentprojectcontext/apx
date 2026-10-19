import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CORE_ENV_FILE, parseCoreEnv, serializeCoreEnv } from "@apx/protocol";

export function desktopCandidates(platform: string, env: NodeJS.ProcessEnv, home: string): string[] {
  if (platform === "darwin") return ["/Applications/APX.app", path.posix.join(home, "Applications", "APX.app")];
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local");
    return [
      path.win32.join(local, "Programs", "apx", "APX.exe"),
      path.win32.join(local, "Programs", "@apxdesktop", "APX.exe"),
    ];
  }
  return [path.posix.join(home, "Applications", "APX.AppImage")];
}

export function desktopDataDir(platform: string, env: NodeJS.ProcessEnv, home: string): string {
  if (env.APX_DESKTOP_DATA) return env.APX_DESKTOP_DATA;
  if (platform === "win32")
    return path.win32.join(env.APPDATA ?? path.win32.join(home, "AppData", "Roaming"), "@apx", "desktop");
  const base =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(base, "@apx", "desktop");
}

export function hasDesktop(platform: string, env: NodeJS.ProcessEnv): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  return (
    platform === "darwin" ||
    platform === "win32" ||
    (platform === "linux" && Boolean(env.DISPLAY || env.WAYLAND_DISPLAY))
  );
}

export type LocalTarget = { home: string; port: number; home_id: string };

/** Keep an environment-only core token in its existing private configuration so desktop can reconnect after login. */
export function prepareLocalTarget(target: LocalTarget, token?: string): LocalTarget {
  if (!token) return target;
  if (fs.readFileSync(path.join(target.home, "home-id"), "utf8").trim() !== target.home_id)
    throw new Error("The APX installation identity changed");
  const file = path.join(target.home, CORE_ENV_FILE);
  const vars = fs.existsSync(file) ? parseCoreEnv(fs.readFileSync(file, "utf8")) : {};
  if (vars.APX_TOKEN === token) return target;
  vars.APX_TOKEN = token;
  const next = `${file}.desktop-${randomUUID()}`;
  try {
    fs.writeFileSync(next, serializeCoreEnv(vars), { mode: 0o600, flag: "wx" });
    fs.renameSync(next, file);
  } finally {
    fs.rmSync(next, { force: true });
  }
  return target;
}

/** A local handoff carries identity, never credentials. The app reads the token from the selected home. */
export function saveLocalTarget(dataDir: string, target: LocalTarget): void {
  if (
    !path.isAbsolute(target.home) ||
    !Number.isInteger(target.port) ||
    target.port < 1 ||
    target.port > 65535 ||
    !target.home_id
  )
    throw new Error("Invalid local APX target");
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const home = fs.realpathSync(target.home);
  if (fs.readFileSync(path.join(home, "home-id"), "utf8").trim() !== target.home_id)
    throw new Error("The APX installation identity changed");
  const file = path.join(dataDir, "connection.json");
  const next = `${file}.install-${randomUUID()}`;
  try {
    fs.writeFileSync(next, JSON.stringify({ mode: "local", ...target, home }), { mode: 0o600, flag: "wx" });
    fs.renameSync(next, file);
  } finally {
    fs.rmSync(next, { force: true });
  }
}
