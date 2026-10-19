import { execFileSync } from "node:child_process";

const DISPLAY_ENV = new Set([
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "XAUTHORITY",
]);

/** A user service may start before login; borrow only display settings from that user's session manager. */
export function desktopSessionEnv(platform: string, env: NodeJS.ProcessEnv, read = readUserSession): NodeJS.ProcessEnv {
  if (platform !== "linux" || env.DISPLAY || env.WAYLAND_DISPLAY || env.SSH_CONNECTION || env.SSH_TTY) return env;
  try {
    const next = { ...env };
    for (const line of read(env).split("\n")) {
      const at = line.indexOf("=");
      const name = line.slice(0, at);
      if (at > 0 && DISPLAY_ENV.has(name)) next[name] = line.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2");
    }
    return next;
  } catch {
    return env;
  }
}

function readUserSession(env: NodeJS.ProcessEnv): string {
  return execFileSync("systemctl", ["--user", "show-environment"], {
    env,
    timeout: 1500,
    maxBuffer: 65536,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}
