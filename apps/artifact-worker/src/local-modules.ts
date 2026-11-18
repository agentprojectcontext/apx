import { readdir } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import type { V4ModuleDefinition } from "miniflare";

export async function localWorkerModules() {
  const dist = new URL("../dist/", import.meta.url);
  const modules: V4ModuleDefinition[] = [{ type: "ESModule", path: fileURLToPath(new URL("index.js", dist)) }];
  for (const name of (await readdir(dist)).sort()) {
    if (/^[a-f0-9]{40}-[A-Za-z0-9_.-]+\.txt$/.test(name))
      modules.push({ type: "Text", path: fileURLToPath(new URL(name, dist)) });
  }
  return { modulesRoot: fileURLToPath(dist), modules };
}
