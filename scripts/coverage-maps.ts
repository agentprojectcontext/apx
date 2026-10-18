import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CoverageSourceMap } from "./test-coverage.ts";

/** Keep generated text and mappings together before another build can replace dist/. */
export function snapshotSourceMaps(directory: string): CoverageSourceMap[] {
  const maps: CoverageSourceMap[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) maps.push(...snapshotSourceMaps(file));
    else if (/\.[cm]?js\.map$/.test(file)) {
      const generated = file.slice(0, -4);
      const map = JSON.parse(fs.readFileSync(file, "utf8")) as Omit<CoverageSourceMap, "url" | "text">;
      maps.push({ ...map, url: pathToFileURL(generated).href, text: fs.readFileSync(generated, "utf8") });
    }
  }
  return maps;
}

export function missingSourceMaps(root: string, urls: string[], maps: CoverageSourceMap[]): string[] {
  const saved = new Set(maps.map((map) => map.url));
  const missing = new Set<string>();
  for (const url of urls) {
    if (!url.startsWith("file:") || saved.has(url)) continue;
    const file = path.relative(root, fileURLToPath(url)).split(path.sep).join("/");
    if (/^(apps\/(web|desktop)|packages\/ui)\/dist\/.*\.[cm]?js$/.test(file)) missing.add(file);
  }
  return [...missing].sort();
}
