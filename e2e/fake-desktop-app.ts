import fs from "node:fs";
import path from "node:path";
import type { DesktopInstallOptions } from "../packages/install/src/desktop.ts";

const APP = { darwin: "APX.app", win32: "APX.exe" }[process.platform as string] ?? "APX.AppImage";

/**
 * The desktop app as the e2e core sees it: installed inside the sandbox, its data folder there too, and opening it only
 * records the launch. The machine's own APX app and its saved connection stay out of reach.
 */
export function fakeDesktopApp(
  root: string,
): Pick<DesktopInstallOptions, "userHome" | "env" | "session" | "candidates" | "run"> {
  const app = path.join(root, "Applications", APP);
  fs.mkdirSync(app, { recursive: true });
  const { SSH_CONNECTION: _connection, SSH_TTY: _tty, ...rest } = process.env;
  // A graphical session on every runner, so the handoff runs the same on a headless Linux.
  const env = { ...rest, APX_DESKTOP_DATA: path.join(root, "data"), DISPLAY: rest.DISPLAY || ":e2e" };
  return {
    userHome: root,
    env,
    session: () => env,
    candidates: [app],
    run: async (command, args) => {
      fs.appendFileSync(path.join(root, "opened.jsonl"), `${JSON.stringify({ command, args })}\n`);
    },
  };
}

/** What the sandbox's desktop app was asked to do: each launch, and the connection the core left it. */
export function desktopAppRecord(root: string): { opened: { command: string; args: string[] }[]; connection: unknown } {
  const read = (file: string) => {
    try {
      return fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      return undefined;
    }
  };
  const lines = read("opened.jsonl")?.trim().split("\n").filter(Boolean) ?? [];
  const connection = read(path.join("data", "connection.json"));
  return {
    opened: lines.map((line) => JSON.parse(line) as { command: string; args: string[] }),
    connection: connection === undefined ? null : JSON.parse(connection),
  };
}
