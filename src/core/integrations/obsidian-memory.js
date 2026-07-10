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

// The wikilink map (MOC) that connects every mirrored note so Obsidian's graph
// + backlinks light up. Lives alongside the notes inside <folder>/.
const INDEX_REL = "APX Memory Index.md";

const noteLink = (rel) => rel.replace(/\.md$/i, "");

// Friendly display for a note in the index: "projects/App/memory" → "App".
function noteDisplay(rel) {
  const parts = noteLink(rel).split("/");
  const leaf = parts[parts.length - 1];
  return parts.length >= 2 && leaf === "memory" ? parts[parts.length - 2] : leaf;
}

function sourceTags(src) {
  const tags = ["#apx/memory"];
  if (src.id === "global" || /Global/i.test(src.rel)) tags.push("#apx/global");
  else if (String(src.id).startsWith("project:") || String(src.rel).startsWith("projects/")) tags.push("#apx/project");
  return tags.join(" ");
}

// One mirrored note: managed markers + tags + a backlink to the index (so the
// graph connects) + the body. Deterministic → idempotent.
function sourceContent(src) {
  return [
    MANAGED_MARK,
    `<!-- source: ${src.from} -->`,
    "",
    sourceTags(src),
    "",
    `> Part of [[${noteLink(INDEX_REL)}]]`,
    "",
    String(src.body).trimEnd(),
    "",
  ].join("\n");
}

function indexContent(sources) {
  const links = sources.map((s) => {
    const link = noteLink(s.rel);
    const disp = noteDisplay(s.rel);
    return link === disp ? `- [[${link}]]` : `- [[${link}|${disp}]]`;
  });
  return [
    MANAGED_MARK,
    "",
    "#apx/memory #apx/index",
    "",
    "# APX Memory Index",
    "",
    "Map of content for APX-managed memory mirrored into this vault.",
    "",
    ...links,
    "",
  ].join("\n");
}

// Mirror the collected sources into <vault>/<folder>/. Idempotent: identical
// input → byte-identical output; each source overwrites its own single note.
// Also writes an index MOC linking every note (not counted in count/changed —
// it's derived meta, not a source).
export function syncMemoryToVault({ vaultPath, folder = "APX", sources = [] }) {
  assertVaultDir(vaultPath);
  const root = path.resolve(vaultPath);
  const base = path.resolve(root, folder);
  const inBase = (abs) => abs === base || abs.startsWith(base + path.sep);
  const writeIdempotent = (abs, content) => {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const prev = readIfExists(abs);
    const changed = prev !== content;
    if (changed) fs.writeFileSync(abs, content);
    return changed;
  };

  const written = [];
  const okSources = [];
  for (const src of sources) {
    const abs = path.resolve(base, src.rel.split("/").join(path.sep));
    if (!inBase(abs)) continue; // never escape the target folder
    const changed = writeIdempotent(abs, sourceContent(src));
    written.push({ id: src.id, note: path.relative(root, abs).split(path.sep).join("/"), changed });
    okSources.push(src);
  }

  let index = null;
  if (okSources.length) {
    const idxAbs = path.resolve(base, INDEX_REL.split("/").join(path.sep));
    index = {
      note: path.relative(root, idxAbs).split(path.sep).join("/"),
      changed: writeIdempotent(idxAbs, indexContent(okSources)),
    };
  }

  return {
    ok: true,
    folder,
    count: written.length,
    changed: written.filter((w) => w.changed).length,
    notes: written,
    index,
  };
}
