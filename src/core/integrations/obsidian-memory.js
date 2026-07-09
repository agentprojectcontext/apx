// Memory ↔ Obsidian sync. Mirrors APX's memory.md files into a folder of the
// active vault so notes are browsable/backup-able in Obsidian — cleanly and
// WITHOUT duplicates: every source file maps to exactly ONE deterministic vault
// note, overwritten in place on each sync (idempotent). We never delete vault
// notes here, so removing a project won't nuke its backup.
import fs from "node:fs";
import path from "node:path";
import { assertVaultDir } from "./plugins/obsidian.js";
import { SELF_MEMORY_PATH } from "#core/agent/self-memory.js";
import { apcMemoryFile } from "#core/apc/paths.js";

const MANAGED_MARK = "<!-- APX-managed mirror — edits are overwritten on next sync -->";

function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// Turn a project name into a safe single vault-folder segment.
function safeSeg(name) {
  const s = String(name || "project")
    .trim()
    .replace(/[/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return s || "project";
}

function projectLabel(entry) {
  return (
    entry?.config?.name ||
    entry?.name ||
    (entry?.path ? path.basename(entry.path) : null) ||
    `project-${entry?.id ?? "?"}`
  );
}

// Gather the APX memory files to mirror: the global notebook (~/.apx/memory.md)
// plus every registered project's committed .apc/memory.md. Each source carries
// a stable `rel` (its 1:1 destination inside the sync folder).
export function collectMemorySources(ctx = {}) {
  const sources = [];

  const globalBody = readIfExists(SELF_MEMORY_PATH);
  if (globalBody != null) {
    sources.push({
      id: "global",
      label: "APX Global Memory",
      rel: "APX Global Memory.md",
      from: SELF_MEMORY_PATH,
      body: globalBody,
    });
  }

  const projects = ctx.projects;
  const list = typeof projects?.list === "function" ? projects.list() : [];
  for (const entry of list) {
    const root = entry?.path;
    if (!root) continue; // the default project (id 0) has no repo root
    const memFile = apcMemoryFile(root);
    const body = readIfExists(memFile);
    if (body == null) continue;
    const seg = safeSeg(projectLabel(entry));
    sources.push({
      id: `project:${entry.id}`,
      label: `${projectLabel(entry)} — memory`,
      rel: path.posix.join("projects", seg, "memory.md"),
      from: memFile,
      body,
    });
  }

  return sources;
}

// Mirror the collected sources into <vault>/<folder>/. Idempotent: identical
// input → byte-identical output; each source overwrites its own single note.
export function syncMemoryToVault({ vaultPath, folder = "APX", sources = [] }) {
  assertVaultDir(vaultPath);
  const root = path.resolve(vaultPath);
  const base = path.resolve(root, folder);
  const written = [];
  for (const src of sources) {
    const abs = path.resolve(base, src.rel.split("/").join(path.sep));
    // Guard: never escape the target folder.
    if (abs !== base && !abs.startsWith(base + path.sep)) continue;
    const content = `${MANAGED_MARK}\n<!-- source: ${src.from} -->\n\n${String(src.body).trimEnd()}\n`;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const prev = readIfExists(abs);
    const changed = prev !== content;
    if (changed) fs.writeFileSync(abs, content);
    written.push({
      id: src.id,
      note: path.relative(root, abs).split(path.sep).join("/"),
      changed,
    });
  }
  return {
    ok: true,
    folder,
    count: written.length,
    changed: written.filter((w) => w.changed).length,
    notes: written,
  };
}
