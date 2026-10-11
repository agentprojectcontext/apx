// What `apx service install` writes: a systemd user unit, a launchd agent, or a Windows login entry. Pure text.
import path from "node:path";
import { BUNDLE } from "@apx/protocol";

export const SYSTEMD_UNIT = "apx.service";
export const LAUNCHD_LABEL = "dev.apx.core";
export const WINDOWS_RUN_VALUE = "APXCore";
export const NODE_FLAGS = ["--disable-warning=ExperimentalWarning"];

/** The core's entry, beside the terminal both in the repo and in the packaged layout (apps/terminal, apps/core). */
export const coreMain = () => path.resolve(import.meta.dirname, "../../../core/src/main.ts");
export const terminalMain = () => path.resolve(import.meta.dirname, "../main.ts");
/** The folder holding apps/: the core runs from there, as the desktop app runs it. */
export const appRoot = (main: string) => path.resolve(path.dirname(main), "../../..");

/**
 * The APX_APP a bundle's terminal lives in (<app>/versions/<version>/apps/terminal/src), for when it runs without the
 * `apx` shim that sets it (the Windows login entry starts the terminal directly).
 */
export function bundleAppOf(terminalSrc: string): string | undefined {
  const version = path.resolve(terminalSrc, "../../..");
  const versions = path.dirname(version);
  return path.basename(versions) === BUNDLE.versions ? path.dirname(versions) : undefined;
}

/**
 * What runs, for a daemon installed from a bundle (APX_APP): always through `current`, never the version folder it
 * points at today, so an update that moves `current` is what the service starts next.
 */
export function bundleRun(app: string, win = process.platform === "win32") {
  const current = path.join(app, BUNDLE.current);
  return {
    node: path.join(current, ...BUNDLE.node(win)),
    core: path.join(current, ...BUNDLE.core),
    terminal: path.join(current, ...BUNDLE.terminal),
    cwd: current,
  };
}

export type ServiceSpec = {
  node: string;
  main: string;
  /** Working directory for the core. */
  cwd: string;
  env: Record<string, string>;
  /** macOS only: where stdout and stderr go. */
  log?: string;
};

/**
 * The environment the service runs with. PATH is kept because the core starts agent CLIs (claude, codex, git) that a
 * login manager's bare PATH would not find; APX_SUPERVISED lets an update exit and be started again.
 */
export function serviceEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = { APX_SUPERVISED: "1" };
  for (const k of ["APX_HOME", "APX_APP", "APX_RELEASES", "ELECTRON_RUN_AS_NODE", "APX_WEB_DIST", "PATH"]) {
    const v = env[k];
    if (v) out[k] = v;
  }
  return out;
}

/** systemd splits on spaces and expands % specifiers: quote every word and double the percents. */
const sdQuote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

export function systemdUnit(spec: ServiceSpec): string {
  const exec = [spec.node, ...NODE_FLAGS, spec.main].map(sdQuote).join(" ");
  const env = Object.entries(spec.env).map(([k, v]) => `Environment=${sdQuote(`${k}=${v}`)}`);
  return `${[
    "[Unit]",
    "Description=APX core",
    "",
    "[Service]",
    `ExecStart=${exec}`,
    // A path as it is: systemd refuses a quoted one here ("path is not absolute"), unlike ExecStart's words.
    `WorkingDirectory=${spec.cwd.replace(/%/g, "%%")}`,
    ...env,
    "Restart=always",
    "RestartSec=2",
    "",
    "[Install]",
    "WantedBy=default.target",
  ].join("\n")}\n`;
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function launchdPlist(spec: ServiceSpec): string {
  const str = (s: string) => `<string>${xml(s)}</string>`;
  const args = [spec.node, ...NODE_FLAGS, spec.main].map((a) => `    ${str(a)}`);
  const env = Object.entries(spec.env).map(([k, v]) => `    <key>${xml(k)}</key>\n    ${str(v)}`);
  const log = spec.log
    ? [`  <key>StandardOutPath</key>`, `  ${str(spec.log)}`, `  <key>StandardErrorPath</key>`, `  ${str(spec.log)}`]
    : [];
  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  ${str(LAUNCHD_LABEL)}`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args,
    "  </array>",
    "  <key>WorkingDirectory</key>",
    `  ${str(spec.cwd)}`,
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    ...env,
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    ...log,
    "</dict>",
    "</plist>",
  ].join("\n")}\n`;
}

/**
 * The Windows login entry: it starts `apx service run`, the terminal's own supervisor, since a Run value cannot
 * restart what dies. Electron's binary only behaves as Node with ELECTRON_RUN_AS_NODE, set through cmd.
 */
export function windowsRunCommand(o: {
  node: string;
  terminal: string;
  home: string;
  electron: boolean;
  /** Variables the login entry sets first (a login starts it with the user's environment, not the installer's). */
  env?: Record<string, string>;
}): string {
  const cmd = `"${o.node}" ${NODE_FLAGS.join(" ")} "${o.terminal}" service run --home "${o.home}"`;
  const env = { ...(o.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}), ...o.env };
  const sets = Object.entries(env).map(([k, v]) => `set ${k}=${v}&& `);
  return sets.length ? `cmd /d /c "${sets.join("")}${cmd}"` : cmd;
}
