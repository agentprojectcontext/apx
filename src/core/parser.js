// Core parsers for APC — pure ESM, no deps.
import fs from "node:fs";
import path from "node:path";

export const SLUG_RE = /^[a-z][a-z0-9_-]*$/;
const H1_RE = /^#\s+Agents\s*$/i;
const H2_RE = /^##\s+(\S.*?)\s*$/;
const FIELD_RE = /^-\s+\*\*([^*]+?)\*\*\s*:\s*(.*)$/;
const INDENT_CONT_RE = /^\s{2,}\S/;
const LIST_FIELDS = new Set(["Skills", "Tools"]);

// ---------------------------------------------------------------------------
// AGENTS.md parser (legacy / Codex compat source)
// ---------------------------------------------------------------------------

export function parseAgentsMd(text) {
  const stripped = text.replace(/<!--[\s\S]*?-->/g, "");
  const lines = stripped.split(/\r?\n/);
  const agents = [];
  let current = null;
  let pendingField = null;
  let seenH1 = false;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (H1_RE.test(line)) { seenH1 = true; continue; }
    const mH2 = line.match(H2_RE);
    if (mH2 && seenH1) {
      const slug = mH2[1].trim();
      if (SLUG_RE.test(slug)) {
        current = { slug, fields: {} };
        agents.push(current);
        pendingField = null;
      } else {
        current = null; pendingField = null;
      }
      continue;
    }
    if (!current) continue;
    const mField = line.match(FIELD_RE);
    if (mField) {
      const name = mField[1].trim();
      const value = mField[2].trim();
      current.fields[name] = LIST_FIELDS.has(name)
        ? value.split(",").map((s) => s.trim()).filter(Boolean)
        : value;
      pendingField = name;
      continue;
    }
    if (pendingField && INDENT_CONT_RE.test(raw)) {
      const existing = current.fields[pendingField];
      if (!Array.isArray(existing)) {
        current.fields[pendingField] = existing ? `${existing} ${raw.trim()}` : raw.trim();
      }
      continue;
    }
    if (line.trim() === "") pendingField = null;
  }
  return agents;
}

// ---------------------------------------------------------------------------
// Per-agent file parser  (.apc/agents/<slug>.md)
// ---------------------------------------------------------------------------

export function parseAgentFile(slug, text) {
  // Extract frontmatter
  const fm = parseSessionFrontmatter(text);

  // Body = everything after the closing ---
  let body = "";
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 4);
    if (end !== -1) body = text.slice(end + 5).trim();
  } else {
    body = text.trim();
  }

  // Normalize keys to Title-case to stay consistent with AGENTS.md output
  const fields = {};
  for (const [k, v] of Object.entries(fm)) {
    if (k === "slug") continue;
    const key = k.charAt(0).toUpperCase() + k.slice(1);
    fields[key] = LIST_FIELDS.has(key)
      ? String(v).split(",").map((s) => s.trim()).filter(Boolean)
      : v;
  }

  return { slug, fields, body };
}

// Read all .apc/agents/<slug>.md files. Returns [] if none exist.
export function readAgentsFromDir(root) {
  const dir = path.join(root, ".apc", "agents");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && SLUG_RE.test(f.slice(0, -3)))
    .sort()
    .map((f) => {
      const slug = f.slice(0, -3);
      return parseAgentFile(slug, fs.readFileSync(path.join(dir, f), "utf8"));
    });
}

// Primary entry point.
// - Agent files (.apc/agents/*.md) are source of truth.
// - If AGENTS.md is the old hand-written format (not auto-generated), merge any
//   agents not yet migrated to individual files so nothing is silently dropped.
export function readAgents(root) {
  const fromFiles = readAgentsFromDir(root);
  const agentsMdPath = path.join(root, "AGENTS.md");
  if (!fs.existsSync(agentsMdPath)) return fromFiles;

  const mdText = fs.readFileSync(agentsMdPath, "utf8");
  // Auto-generated marker — it's just a cache, don't merge from it.
  if (mdText.includes("Auto-generated from .apc/agents/")) return fromFiles;

  // Legacy hand-written AGENTS.md: include any agents not yet migrated to files.
  const fileSlugs = new Set(fromFiles.map((a) => a.slug));
  const legacy = parseAgentsMd(mdText).filter((a) => !fileSlugs.has(a.slug));
  return [...fromFiles, ...legacy];
}

// ---------------------------------------------------------------------------
// Project root detection
// ---------------------------------------------------------------------------

export function findApfRoot(start = process.cwd()) {
  let cur = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(cur, ".apc", "project.json"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

// ---------------------------------------------------------------------------
// Session / conversation frontmatter
// ---------------------------------------------------------------------------

export function parseSessionFrontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end === -1) return {};
  const out = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
