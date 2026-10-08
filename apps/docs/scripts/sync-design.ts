// Copies the blobos (bodies + eye boxes) from the design system into the docs, which install apart from the
// workspace and so cannot import @apx/ui. Run again after the catalog changes: node scripts/sync-design.ts
import fs from "node:fs";
import path from "node:path";
import { BLOBS } from "../../../packages/ui/src/blobs/catalog.ts";

const here = import.meta.dirname;
const from = path.join(here, "../../../packages/ui/src/blobs/bodies");
const to = path.join(here, "../src/assets/blobs");
fs.mkdirSync(to, { recursive: true });
const out: Record<string, { label: string; eyeColor: string; eyes: unknown[] }> = {};
for (const [name, b] of Object.entries(BLOBS)) {
  fs.copyFileSync(path.join(from, `${name}.webp`), path.join(to, `${name}.webp`));
  out[name] = { label: b.label, eyeColor: b.eyeColor, eyes: b.eyes };
}
fs.writeFileSync(path.join(here, "../src/data/blobs.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${Object.keys(out).length} blobos synced`);
