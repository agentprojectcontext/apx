// apx init: makes a folder an APC project and registers it with APX. The core writes the files, only what is missing.
import fs from "node:fs";
import path from "node:path";
import type { ApxClient } from "@apx/protocol/client";

export const INIT_USAGE = `apx init [folder] [--json]   Make a folder (default: this one) an APC project and register it with APX
                             Writes only what is missing (AGENTS.md naming the project, an empty .apc/); never
                             changes an existing file. Again on a registered folder: reads its files again`;

/** What a folder lacks to be an APC project, as the core would fill it in. */
const missingIn = (dir: string) =>
  ["AGENTS.md", ".apc"].filter((f) => fs.existsSync(dir) && !fs.existsSync(path.join(dir, f)));

export async function init(
  client: ApxClient,
  [folder, extra]: string[],
  o: { json?: boolean | undefined; cwd?: string } = {},
): Promise<void> {
  if (folder === "help") {
    console.log(INIT_USAGE);
    return;
  }
  if (extra) throw new Error(`usage: ${INIT_USAGE.split("\n")[0]}`);
  const dir = path.resolve(o.cwd ?? process.cwd(), folder ?? ".");
  const missing = missingIn(dir);
  const known = (await client.call("projects.list", {})).projects.some((p) => p.path && path.resolve(p.path) === dir);
  const r = await client.call("projects.register", { path: dir, init: true });
  const created = missing.filter((f) => fs.existsSync(path.join(dir, f)));
  if (o.json) {
    console.log(JSON.stringify({ project: r.project, agents: r.agents, created, already: known }, null, 2));
    return;
  }
  const what = `${r.project.name} (${r.project.id}) · ${r.agents} ${r.agents === 1 ? "agent" : "agents"}`;
  console.log(known ? `Already a project in APX: ${what}` : `Registered ${what}`);
  console.log(`  ${dir}`);
  for (const f of created) console.log(`  Created ${f === ".apc" ? ".apc/" : f}`);
  if (!created.length) console.log("  Nothing written: its AGENTS.md and .apc/ were already there");
  if (!r.agents) console.log(`\nNext: apx agents new <slug> "<Name>" --project ${r.project.id} --role "<role>"`);
}
