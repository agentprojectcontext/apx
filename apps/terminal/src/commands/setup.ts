// apx setup --headless: bring APX up on a server with no desktop, in the order a person would do it by hand.
import type { ApxClient } from "@apx/protocol/client";
import { setExposure } from "./expose.ts";
import { localConnection, waitForCore } from "./local.ts";
import { pair } from "./pair.ts";
import { install, restart } from "./service.ts";

export type ImportOptions = { keys: boolean; skills: boolean; services: boolean };

/** What v1 holds that the import copies without asking; keys, skills and services only when their flag says so. */
const OPT_IN = { keys: "keys", skills: "skills", services: "services" } as const;

/**
 * From v1's files, as the desktop setup imports (v1's daemon may already be stopped: install.sh stops it before
 * v2 starts). Only the groups v1 has something in.
 */
export async function importV1(client: ApxClient, o: ImportOptions): Promise<void> {
  const { groups } = await client.call("setup.v1_scan", {});
  const optIn = new Set<string>(Object.values(OPT_IN));
  const wanted = groups
    .filter((g) => g.count > 0)
    .map((g) => g.id)
    .filter((id) => !optIn.has(id) || o[id as keyof ImportOptions]);
  if (!wanted.length) return console.log("APX v1 has nothing to import here");
  const r = await client.call("setup.import_v1", { groups: wanted });
  const counts = Object.entries(r.imported).filter(([, n]) => n > 0);
  console.log(`imported from v1: ${counts.map(([g, n]) => `${n} ${g}`).join(", ") || "nothing new"}`);
  for (const e of r.errors) console.error(`  ${e}`);
}

/** `client()` is called after each step: exposing creates the token the next calls need. */
export async function setupHeadless(
  client: () => ApxClient,
  o: { headless?: boolean | undefined; import?: ImportOptions | undefined; expose?: string | undefined },
): Promise<void> {
  if (!o.headless) throw new Error("usage: apx setup --headless [--import] [--expose tailscale|lan]");
  const mode = o.expose === "tailscale" || o.expose === "lan" ? o.expose : undefined;
  if (o.expose && !mode) throw new Error("--expose takes tailscale or lan");
  const step = (n: number, text: string) => console.log(`\n[${n}] ${text}`);
  const up = async () => {
    const { url } = localConnection();
    if (!(await waitForCore(url))) throw new Error(`the core did not answer on ${url} (see apx service status)`);
  };

  step(1, "Run the core as a service");
  await install();
  await up();
  if (o.import) {
    step(2, "Import APX v1's projects and agents");
    await importV1(client(), o.import);
  }
  if (mode) {
    step(3, `Expose the core (${mode})`);
    await setExposure(mode);
    await restart();
    // The old core may still answer for a moment while it closes.
    await new Promise((r) => setTimeout(r, 1500));
    await up();
  }
  step(4, "Pair a device");
  await pair(client());
}
