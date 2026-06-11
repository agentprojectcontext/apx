// Snapshot a project's read-aloud context — AGENTS.md + .apc/memory.md —
// into a single labelled markdown string. Used by /deck/context/copy and
// (potentially) any other "give me the context" surface.
import fs from "node:fs/promises";
import { AGENTS_MD, apcMemoryFile } from "./paths.js";
import path from "node:path";

const CONTEXT_FILES = [
  { rel: AGENTS_MD,              label: AGENTS_MD },
  { rel: `.apc/${"memory.md"}`,  label: ".apc/memory.md", abs: (root) => apcMemoryFile(root) },
];

export async function readProjectContext(projectPath) {
  const chunks = [];
  for (const entry of CONTEXT_FILES) {
    const abs = entry.abs ? entry.abs(projectPath) : path.join(projectPath, entry.rel);
    try {
      const content = await fs.readFile(abs, "utf8");
      if (content.trim()) {
        chunks.push(`# ${entry.label}\n\n${content.trim()}\n`);
      }
    } catch {
      // missing file is fine; we just skip it.
    }
  }
  return chunks.join("\n---\n\n");
}
