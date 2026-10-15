import path from "node:path";
import { withUsualDirs } from "../programs.ts";

/** The folder of the core's own `apx` launcher (harness/apx-command.ts), set once the core listens. */
let commandBin: string | undefined;

/** Whether agents' PATH gets the usual program folders: only for a core the desktop app or a service started. */
let usualDirs = false;

/** A supervised core (desktop app, launchd, systemd) got the system's bare PATH; one started by hand keeps its own. */
export function useUsualDirs(on: boolean): void {
  usualDirs = on;
}

/** Puts this core's `apx` first on the PATH of everything agents run; undefined takes it off. */
export function useApxCommand(bin: string | undefined): void {
  commandBin = bin;
}

/**
 * An agent CLI (Claude Code, Codex, an ACP agent) gets the environment minus APX's own secrets, with this core's `apx`
 * first on its PATH and, for a supervised core, the usual program folders (Homebrew, ~/.local/bin) its PATH lacks.
 */
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("APX_")) env[k] = v;
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const own = env[key] ?? "";
  env[key] = [commandBin, usualDirs ? withUsualDirs(own) : own].filter(Boolean).join(path.delimiter);
  return env;
}

/** Variable names that usually hold credentials. */
export const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE)/i;

/**
 * A command an agent runs gets less: no credentials at all. Agent CLIs may need their own keys; a shell command
 * started by a model must not be able to print them.
 */
export function commandEnv(): Record<string, string> {
  const env = childEnv();
  for (const k of Object.keys(env)) if (SECRET_NAME.test(k)) delete env[k];
  return env;
}

/** An agent harness process (Claude Code, Codex): the environment minus APX's own secrets, and who is calling. */
export function harnessEnv(): Record<string, string> {
  return { ...childEnv(), CLAUDE_AGENT_SDK_CLIENT_APP: "apx/2" };
}
