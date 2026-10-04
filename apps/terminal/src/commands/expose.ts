// apx2 expose: who may reach the core (this computer, the network, or the owner's tailnet). Edits <home>/core.env.
import fs from "node:fs";
import path from "node:path";
import { CORE_ENV_KEYS } from "@apx/protocol";
import { describeExposure, type ExposeMode, planExposure, tailscaleDnsName } from "./expose-plan.ts";
import { apxHome, coreEnvPath, corePort, readCoreEnvFile, writeCoreEnvFile } from "./local.ts";
import { sh } from "./service.ts";

const USAGE = `apx2 expose tailscale   Reach the core at https://<this machine>.ts.net from your tailnet (the core stays on loopback)
apx2 expose lan         Listen on every network address of this machine (needs a token, created if missing)
apx2 expose off         Back to this computer only (the token is kept)
apx2 expose status`;

const MAC_TAILSCALE = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

export function findTailscale(): string | undefined {
  const names = process.platform === "win32" ? ["tailscale.exe"] : ["tailscale"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean))
    for (const n of names) if (fs.existsSync(path.join(dir, n))) return path.join(dir, n);
  if (process.platform === "darwin" && fs.existsSync(MAC_TAILSCALE)) return MAC_TAILSCALE;
  return undefined;
}

export async function expose(sub: string | undefined): Promise<void> {
  if (sub === "status") return exposeStatus();
  if (sub !== "tailscale" && sub !== "lan" && sub !== "off") throw new Error(USAGE);
  await setExposure(sub);
}

/** Changes core.env for a mode; returns once the file is written (the core picks it up when it starts again). */
export async function setExposure(mode: ExposeMode): Promise<void> {
  const home = apxHome();
  const current = readCoreEnvFile(home);
  const port = corePort();
  const tailscale = findTailscale();
  let tailscaleUrl: string | undefined;
  if (mode === "tailscale") {
    if (!tailscale) throw new Error("Tailscale is not installed (https://tailscale.com/download), or not on PATH");
    const st = sh(tailscale, ["status", "--json"]);
    const dns = st.ok ? tailscaleDnsName(st.out) : undefined;
    if (!dns) throw new Error("Tailscale is not connected, or MagicDNS is off: run `tailscale up` and try again");
    tailscaleUrl = `https://${dns}`;
  }
  const plan = planExposure(current, mode, tailscaleUrl ? { tailscaleUrl } : {});
  writeCoreEnvFile(home, plan.vars);
  if (plan.generatedToken) {
    console.log(`Created the core's token (shown only now; it is kept in ${coreEnvPath(home)}):`);
    console.log(`  ${plan.generatedToken}`);
  }

  if (mode === "tailscale" && tailscale) {
    const r = sh(tailscale, ["serve", "--bg", "--https=443", `http://127.0.0.1:${port}`], true);
    if (!r.ok)
      throw new Error("`tailscale serve` failed; HTTPS may need enabling for your tailnet in Tailscale's admin");
    console.log(`APX is at ${tailscaleUrl} for every device in your tailnet`);
  } else if (mode === "off" && tailscale && current.APX_PUBLIC_URL) {
    // Only undo what `expose tailscale` set up: other serve configs on this machine are not APX's.
    sh(tailscale, ["serve", "--https=443", "off"]);
  }
  console.log(describeExposure(plan.vars));
  console.log(
    [
      "",
      "The core reads this when it starts: restart it (apx2 service restart, when installed as a service).",
      mode === "off"
        ? "Local clients keep using the token: the terminal and the desktop app read it from core.env."
        : "Local clients now need the token: the terminal and the desktop app read it from core.env on their own.",
      mode === "off" ? "" : "Then connect a phone or another computer with: apx2 pair",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function exposeStatus() {
  const home = apxHome();
  const file = readCoreEnvFile(home);
  const effective: Record<string, string> = { ...file };
  const overridden: string[] = [];
  for (const k of CORE_ENV_KEYS) {
    const v = process.env[k];
    if (v === undefined) continue;
    if (file[k] !== undefined && file[k] !== v) overridden.push(k);
    effective[k] = v;
  }
  console.log(describeExposure(effective));
  console.log(`port     ${corePort()}${process.env.APX_URL ? ` (this terminal talks to ${process.env.APX_URL})` : ""}`);
  console.log(`token    ${effective.APX_TOKEN ? "set" : "none (the core only accepts this computer)"}`);
  console.log(`settings ${coreEnvPath(home)}${Object.keys(file).length ? "" : " (none yet)"}`);
  if (overridden.length) console.log(`the environment overrides: ${overridden.join(", ")}`);
}
