// apx init: makes a folder a project and registers it with APX. The core writes the files, only what is missing.
import fs from "node:fs";
import path from "node:path";
import type { ApxClient } from "@apx/protocol/client";

const INIT_USAGE = `apx init [folder] [--json]   Make a folder (default: this one) a project and register it with APX
                             Writes only what is missing (AGENTS.md naming the project, an empty .agent/); never
                             changes an existing file. Again on a registered folder: reads its files again`;

/** What a folder lacks to be a project, as the core would fill it in. */
const missingIn = (dir: string) =>
  ["AGENTS.md", ".agent"].filter((f) => fs.existsSync(dir) && !fs.existsSync(path.join(dir, f)));

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
  for (const f of created) console.log(`  Created ${f === ".agent" ? ".agent/" : f}`);
  if (!created.length)
    console.log(
      r.project.legacy_folder ? "  Nothing written" : "  Nothing written: its AGENTS.md and .agent/ were already there",
    );
  if (r.project.legacy_folder)
    console.log(
      "\nIts agents and settings are still in .apc/, the folder older APX versions used. Move them to .agent/: apx doctor --fix",
    );
  else if (!r.agents) console.log(`\nNext: apx agents new <slug> "<Name>" --project ${r.project.id} --role "<role>"`);
}
