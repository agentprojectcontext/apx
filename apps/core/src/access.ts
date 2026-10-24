// Who may reach this core, from the panel: this computer only, the local network, or the owner's tailnet. The choice
// is saved in core.env (the core reads it when it starts), so a change restarts a supervised core.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  type AccessMode,
  accessOf,
  CORE_ENV_FILE,
  parseCoreEnv,
  planExposure,
  serializeCoreEnv,
  tailscaleDnsName,
} from "@apx/protocol";
import { CallError } from "./errors.ts";

const MAC_TAILSCALE = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

/** Runs the tailscale CLI without blocking the core; never rejects (a failure is ok:false). */
export type TailscaleRun = (args: string[]) => Promise<{ ok: boolean; out: string }>;

export type AccessState = {
  /** What this running core does now. */
  mode: AccessMode;
  /** What core.env says: the core takes it on its next start. */
  saved: AccessMode;
  restart_needed: boolean;
  /** Where other devices reach it now (empty: only this computer). */
  urls: string[];
  token_set: boolean;
  tailscale: { installed: boolean; connected: boolean; url?: string };
};

export function findTailscale(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const name = process.platform === "win32" ? "tailscale.exe" : "tailscale";
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean))
    if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  if (process.platform === "darwin" && fs.existsSync(MAC_TAILSCALE)) return MAC_TAILSCALE;
  return undefined;
}

export const tailscaleRunner =
  (bin: string): TailscaleRun =>
  (args) =>
    new Promise((resolve) => {
      execFile(
        bin,
        args,
        {
          encoding: "utf8",
          timeout: 5000,
          windowsHide: true,
          // The macOS app binary otherwise tries to open its GUI when started by a daemon.
          env: { ...process.env, TAILSCALE_BE_CLI: "1" },
        },
        (err, stdout, stderr) =>
          resolve(
            err ? { ok: false, out: `${stdout ?? ""}${stderr ?? ""}` || err.message } : { ok: true, out: stdout },
          ),
      );
    });

export function createAccess(deps: {
  home: string;
  /** How this core was started (its host and public URL, from the config it loaded). */
  running: { host: string; publicUrl: string | undefined; token: string | undefined };
  port: () => number;
  addresses: () => string[];
  /** Starts the core again (a supervisor brings it back); none when nothing would. */
  restart?: (() => void) | undefined;
  /** The tailscale CLI; found on this machine when not given (tests pass a fake). */
  tailscale?: TailscaleRun | undefined;
}) {
  const file = path.join(deps.home, CORE_ENV_FILE);
  const read = (): Record<string, string> => {
    try {
      return parseCoreEnv(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };
  const tailscaleRun = (): TailscaleRun | undefined => {
    if (deps.tailscale) return deps.tailscale;
    const bin = findTailscale();
    return bin ? tailscaleRunner(bin) : undefined;
  };
  const tailscaleName = async (run: TailscaleRun | undefined): Promise<string | undefined> => {
    const st = await run?.(["status", "--json"]);
    return st?.ok ? tailscaleDnsName(st.out) : undefined;
  };

  async function state(): Promise<AccessState> {
    const vars = read();
    const mode = accessOf({ APX_HOST: deps.running.host, APX_PUBLIC_URL: deps.running.publicUrl });
    const saved = accessOf(vars);
    const run = tailscaleRun();
    const dns = await tailscaleName(run);
    return {
      mode,
      saved,
      restart_needed: mode !== saved,
      urls: mode === "local" ? [] : deps.addresses(),
      token_set: Boolean(deps.running.token || vars.APX_TOKEN),
      tailscale: { installed: Boolean(run), connected: Boolean(dns), ...(dns ? { url: `https://${dns}` } : {}) },
    };
  }

  return {
    state,
    /** Saves the choice and, when the running core differs, restarts it if a supervisor will bring it back. */
    async set(mode: AccessMode): Promise<AccessState & { restarting: boolean }> {
      const current = read();
      const run = tailscaleRun();
      let tailscaleUrl: string | undefined;
      if (mode === "tailscale") {
        if (!run) throw new CallError({ code: "bad_request", message: "Tailscale is not installed on this computer" });
        const dns = await tailscaleName(run);
        if (!dns)
          throw new CallError({ code: "bad_request", message: "Tailscale is not connected (or MagicDNS is off)" });
        tailscaleUrl = `https://${dns}`;
        const served = await run(["serve", "--bg", "--https=443", `http://127.0.0.1:${deps.port()}`]);
        if (!served.ok)
          throw new CallError({
            code: "bad_request",
            message: "tailscale serve failed: HTTPS may need turning on for your tailnet",
          });
      } else if (current.APX_PUBLIC_URL && run) {
        // Only undo what APX set up: other serve configs on this machine are not APX's.
        await run(["serve", "--https=443", "off"]);
      }
      const plan = planExposure(current, mode === "local" ? "off" : mode, tailscaleUrl ? { tailscaleUrl } : {});
      fs.mkdirSync(deps.home, { recursive: true });
      fs.writeFileSync(file, serializeCoreEnv(plan.vars), { mode: 0o600 });
      fs.chmodSync(file, 0o600);
      const now = await state();
      const restarting = now.restart_needed && Boolean(deps.restart);
      // After the answer has gone out: the panel learns it first, then sees the core come back.
      if (restarting) setTimeout(() => deps.restart?.(), 400).unref();
      return { ...now, restarting };
    },
  };
}
