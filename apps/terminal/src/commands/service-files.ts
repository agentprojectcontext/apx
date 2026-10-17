// What `apx service install` writes: a systemd user unit, a launchd agent, or a Windows login entry. Pure text.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUNDLE } from "@apx/protocol";

export const SYSTEMD_UNIT = "apx.service";
export const LAUNCHD_LABEL = "dev.apx.core";
export const WINDOWS_RUN_VALUE = "APXCore";
export const NODE_FLAGS = ["--disable-warning=ExperimentalWarning"];

/** A custom home must not restart or replace the default installation's service. */
export function serviceNames(home: string, defaultHome = path.join(os.homedir(), ".apx", "v2")) {
  const real = (p: string) => (fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p));
  const canonical = real(home);
  const suffix =
    canonical === real(defaultHome) ? "" : `-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
  return {
    systemd: suffix ? `apx${suffix}.service` : SYSTEMD_UNIT,
    launchd: `${LAUNCHD_LABEL}${suffix}`,
    windows: `${WINDOWS_RUN_VALUE}${suffix}`,
  };
}

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

/** Sets APX_APP for a terminal that runs from a bundle; a checkout leaves it unset (process.env would store "undefined"). */
export function adoptBundleApp(env: NodeJS.ProcessEnv, terminalSrc: string): void {
  if (env.APX_APP) return;
  const app = bundleAppOf(terminalSrc);
  if (app) env.APX_APP = app;
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
  /** The selected home's launchd identity. */
  label?: string;
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

/** Refuse an old fixed-name service that was installed for a different home. */
export function serviceOwnsHome(text: string, platform: string, home: string): boolean {
  let configured: string | undefined;
  if (platform === "win32") configured = /service run --home "([^"]+)"/.exec(text)?.[1];
  else if (platform === "darwin") {
    configured = /<key>APX_HOME<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1];
    configured = configured?.replace(
      /&(amp|lt|gt|quot|apos);/g,
      (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity] ?? entity,
    );
  } else {
    configured = /^Environment="APX_HOME=((?:\\.|[^"\\])*)"$/m.exec(text)?.[1];
    configured = configured?.replace(/\\(.)/g, "$1").replace(/%%/g, "%");
  }
  if (configured) {
    const canonical = (p: string) => (fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p));
    return canonical(configured) === canonical(home);
  }
  return platform !== "win32" && !text.includes("APX_HOME") && serviceNames(home).systemd === SYSTEMD_UNIT;
}

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
    `  ${str(spec.label ?? LAUNCHD_LABEL)}`,
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

/** Node and cmd may quote space-free arguments differently; match complete argv, never a substring. */
export function windowsProcessPattern(args: string[]): string {
  return `^${args
    .map((arg) => {
      const escaped = arg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return /\s/.test(arg) ? `"${escaped}"` : `(?:"${escaped}"|${escaped})`;
    })
    .join("[ \\t]+")}$`;
}

/** Stops only the registered supervisor and its direct core children, never a PID file or the caller's paths. */
export function windowsStopScript(home: string, command: string): string {
  const match = /"([^"]+)" ([^"]*) "([^"]+)" service run --home "([^"]+)""?$/.exec(command);
  if (!match || match[2] !== NODE_FLAGS.join(" ") || !serviceOwnsHome(command, "win32", home))
    throw new Error("The Windows service command is not recognized for this home; no process was stopped.");
  const node = match[1] as string;
  const terminal = match[3] as string;
  const registeredHome = match[4] as string;
  const quote = (value: string) => value.replaceAll("'", "''");
  const supervisor = quote(
    windowsProcessPattern([node, ...NODE_FLAGS, terminal, "service", "run", "--home", registeredHome]),
  );
  const main = path.win32.resolve(path.win32.dirname(terminal), "../../core/src/main.ts");
  const core = quote(windowsProcessPattern([node, ...NODE_FLAGS, main]));
  return [
    `$all = @(Get-CimInstance Win32_Process)`,
    `; $parents = @($all | Where-Object { ($_.CommandLine -ceq '${quote(command)}') -or ($_.CommandLine -imatch '${supervisor}') } | ForEach-Object { $_.ProcessId })`,
    `; $ids = @($all | Where-Object { ($parents -contains $_.ProcessId) -or (($parents -contains $_.ParentProcessId) -and $_.CommandLine -imatch '${core}') } | ForEach-Object { $_.ProcessId })`,
    `; if ($ids.Count) { Stop-Process -Id $ids -Force -ErrorAction Stop; Wait-Process -Id $ids -Timeout 10 -ErrorAction SilentlyContinue }`,
  ].join(" ");
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
