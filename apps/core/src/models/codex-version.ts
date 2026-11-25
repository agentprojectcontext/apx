import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { which } from "../harness/detect.ts";

const run = promisify(execFile);
const KNOWN_CODEX = "0.172.0";

async function installedVersion(): Promise<string | undefined> {
  const bin = await which("codex");
  if (!bin) return undefined;
  const out = await run(bin, ["--version"], { timeout: 10_000 });
  return out.stdout;
}

/** The plan filters its catalog by client version; refreshes must notice CLI upgrades without a core restart. */
export async function codexVersion(readVersion: () => Promise<string | undefined> = installedVersion): Promise<string> {
  const output = await readVersion().catch(() => undefined);
  const version = output?.match(/\b\d+\.\d+\.\d+\b/)?.[0];
  return version && version.localeCompare(KNOWN_CODEX, undefined, { numeric: true }) > 0 ? version : KNOWN_CODEX;
}
