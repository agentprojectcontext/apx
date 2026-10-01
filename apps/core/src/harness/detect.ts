// Which engines can run a turn on this machine: installed → logged in. Login is asked to each CLI itself;
// APX never reads, copies or refreshes their tokens.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function cli(cmd: string, args: string[]): Promise<string | undefined> {
  try {
    // Some CLIs (codex login status) answer on stderr.
    const { stdout, stderr } = await run(cmd, args, { timeout: 15_000, maxBuffer: 1024 * 1024 });
    return stdout.trim() || stderr.trim() || undefined;
  } catch {
    return undefined;
  }
}

const whichCache = new Map<string, { at: number; path: string | undefined }>();

/** Absolute path of a binary on PATH (the owner's own install), cached for a minute. */
export async function which(bin: string): Promise<string | undefined> {
  const hit = whichCache.get(bin);
  if (hit && Date.now() - hit.at < 60_000) return hit.path;
  const out = await cli("/usr/bin/which", [bin]);
  const path = out?.split("\n")[0] || undefined;
  whichCache.set(bin, { at: Date.now(), path });
  return path;
}

export type CliStatus = { installed: boolean; logged_in: boolean; version?: string; detail?: string };

export async function detectClaude(): Promise<CliStatus> {
  const bin = await which("claude");
  if (!bin) return { installed: false, logged_in: false };
  const [version, auth] = await Promise.all([cli(bin, ["--version"]), cli(bin, ["auth", "status", "--json"])]);
  let logged = false;
  let detail: string | undefined;
  try {
    const a = JSON.parse(auth ?? "{}") as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
    logged = Boolean(a.loggedIn);
    detail = [a.authMethod, a.subscriptionType].filter(Boolean).join(" · ") || undefined;
  } catch {}
  return {
    installed: true,
    logged_in: logged,
    ...(version ? { version: version.split(" ")[0] } : {}),
    ...(detail ? { detail } : {}),
  };
}

export async function detectCodex(): Promise<CliStatus> {
  const bin = await which("codex");
  if (!bin) return { installed: false, logged_in: false };
  const [version, login] = await Promise.all([cli(bin, ["--version"]), cli(bin, ["login", "status"])]);
  return {
    installed: true,
    logged_in: /logged in/i.test(login ?? ""),
    ...(version ? { version: version.replace(/^codex-cli\s*/, "") } : {}),
    ...(login ? { detail: login.replace(/^Logged in using\s*/i, "") } : {}),
  };
}
