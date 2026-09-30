// Per-turn situational context: which project this turn is about, and what the
// agent must know about it before acting — its agents, its MCP servers, its
// rules (root AGENTS.md plus the nested ones), and the durable core of its
// memory.
//
// Before this, the only project a turn knew was the one its CHANNEL was pinned
// to. Telegram is pinned to `default`, so naming a project there gave the model
// a line in an index (name + path) and nothing else: it guessed which agent
// owned the work, which MCP to use, and never learned that a subfolder carried
// its own rules. The reference behaviour is Hermes' subdirectory hints and
// OpenCode's instruction discovery.
import fs from "node:fs";
import path from "node:path";
import { agentsMdFile, apcMemoryFile } from "#core/apc/paths.js";
import { readAgents } from "#core/apc/parser.js";
import { isMasterAgent } from "#core/apc/agent-identity.js";
import { describeMcpLine } from "#core/mcp/catalog.js";

const AGENTS_MD = "AGENTS.md";
// Where the nested-rules walk never goes: dependency trees, VCS, build output.
const SKIP_DIRS = new Set(["node_modules", ".git", ".apc", "dist", "build", "vendor", ".next", ".venv", "venv", "__pycache__", "target", "coverage"]);

/** Lowercase, accents off, anything that is not a letter or digit → space. */
export function normalizeForMatch(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function projectAliases(entry) {
  const out = new Set();
  const add = (v) => {
    const n = normalizeForMatch(v);
    if (n.length >= 3) out.add(n);
  };
  add(entry?.name);
  if (entry?.path) add(path.basename(entry.path));
  return [...out];
}

/**
 * Which registered project a piece of text names, or null. Word-bounded on the
 * normalised text; a multi-word or long name also matches written together
 * ("North Wind" ↔ "northwind"). The longest match wins, so "acme v2" beats a
 * shorter name it contains.
 */
export function projectNamedIn(text, projects) {
  const hay = ` ${normalizeForMatch(text)} `;
  if (hay.trim().length < 3) return null;
  const squashed = hay.replace(/ /g, "");
  let best = null;
  for (const entry of projects?.list?.() || []) {
    if (entry == null || String(entry.id) === "0") continue;
    for (const alias of projectAliases(entry)) {
      const hit = hay.includes(` ${alias} `)
        || (alias.replace(/ /g, "").length >= 6 && squashed.includes(alias.replace(/ /g, "")));
      if (hit && (!best || alias.length > best.alias.length)) best = { entry, alias };
    }
  }
  return best ? best.entry : null;
}

/**
 * The project this turn is about.
 *   pinned — the surface already works inside one project (web project chat,
 *            a code session, a project agent's channel)
 *   named  — the owner named a registered project in this message
 *   thread — a recent message of this conversation named one
 * Returns { project, reason, alias } or null.
 */
export function resolveTurnProject({ prompt, previousMessages = [], projects, channelMeta = {} } = {}) {
  if (!projects?.list) return null;
  // get() carries the storage paths, list() the display name — the block needs both.
  const full = (entry) => {
    const got = projects.get?.(entry.id);
    return got ? Object.assign(Object.create(got), { name: got.name || entry.name }) : entry;
  };
  const pinnedPath = channelMeta?.projectPath;
  if (pinnedPath) {
    const pinned = (projects.list() || []).find(
      (p) => p?.path && path.resolve(p.path) === path.resolve(pinnedPath) && String(p.id) !== "0"
    );
    if (pinned) return { project: full(pinned), reason: "pinned" };
  }
  const named = projectNamedIn(prompt, projects);
  if (named) return { project: full(named), reason: "named" };
  // Most recent first, and only the owner's side: the model's own replies name
  // projects it was merely asked about.
  const recentUser = previousMessages.filter((m) => m?.role === "user").slice(-6).reverse();
  for (const m of recentUser) {
    const hit = projectNamedIn(typeof m.content === "string" ? m.content : "", projects);
    if (hit) return { project: full(hit), reason: "thread" };
  }
  return null;
}

/**
 * Nested AGENTS.md files under a project root (the root one excluded),
 * shallowest first. Bounded in depth and count so a monorepo cannot make this
 * a filesystem crawl on every turn.
 */
export function listNestedAgentsFiles(root, { maxDepth = 4, max = 25 } = {}) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth || found.length >= max) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (depth > 0 && entries.some((e) => e.isFile() && e.name === AGENTS_MD)) {
      found.push(path.relative(root, path.join(dir, AGENTS_MD)));
    }
    for (const e of entries) {
      if (found.length >= max) break;
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  if (root) walk(root, 0);
  return found;
}

/**
 * The durable part of a memory file: everything above its first dated
 * section ("## 2026-09-20"). Below that line is a log of what happened, which
 * belongs to retrieval, not to every prompt.
 */
export function memoryCore(text, maxChars = 3000) {
  const body = String(text || "");
  const firstDated = body.search(/^##\s+\d{4}-\d{2}-\d{2}/m);
  const core = (firstDated >= 0 ? body.slice(0, firstDated) : body).trim();
  if (core.length <= maxChars) return core;
  const cut = core.slice(0, maxChars);
  const nl = cut.lastIndexOf("\n");
  return `${(nl > maxChars * 0.5 ? cut.slice(0, nl) : cut).trimEnd()}\n…(truncated — the full file is in the project memory)`;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function capText(text, max) {
  if (!max || text.length <= max) return text;
  const head = text.slice(0, max);
  const nl = head.lastIndexOf("\n");
  const kept = nl > max * 0.5 ? head.slice(0, nl) : head;
  return `${kept.trimEnd()}\n\n…(truncated: ${text.length - kept.length} of ${text.length} characters omitted. Read the file before relying on rules not shown.)`;
}

function agentLine(agent) {
  const f = agent.fields || {};
  const role = f.Role || f.Description || "";
  const lead = isMasterAgent(agent) ? " (lead)" : "";
  return `\`${agent.slug}\`${lead}${role ? ` — ${String(role).replace(/\s+/g, " ").slice(0, 120)}` : ""}`;
}

const REASON_TEXT = {
  pinned: "this surface works inside it",
  named: "you were addressed about it in this message",
  thread: "it was named earlier in this conversation",
};

/**
 * The "# This turn's project" block. `includeAgentsMd` is false when the
 * caller already put the root AGENTS.md in the prompt.
 */
export function buildSituationBlock({
  resolved,
  registries = null,
  globalMcps = [],
  includeAgentsMd = true,
  agentsMdMaxChars = 12000,
  memoryMaxChars = 3000,
} = {}) {
  const project = resolved?.project;
  if (!project?.path) return "";
  const root = project.path;
  const lines = [
    `# This turn's project: ${project.name} (\`${root}\`)`,
    `In focus because ${REASON_TEXT[resolved.reason] || "it is the working project"}. Paths for file and shell tools on this work are relative to that root (pass \`project: "${project.name}"\`).`,
  ];

  let agents = [];
  try {
    agents = readAgents(root) || [];
  } catch {
    agents = [];
  }
  if (agents.length) {
    const lead = agents.find(isMasterAgent);
    lines.push("", "## Its agents", ...agents.slice(0, 20).map((a) => `- ${agentLine(a)}`));
    lines.push(
      "",
      `Work that belongs to this project goes to its agents${lead ? ` — start with \`${lead.slug}\`` : ""}: ` +
      "delegate with `send_to_agent` (background, you get the result back) or `call_agent` (short, while the owner waits), " +
      "passing everything they need — they did not see this conversation. Do it yourself only when it is a quick read, " +
      "when the owner asked you to, or when no agent covers it."
    );
  }

  let mcps = [];
  try {
    mcps = registries?.for?.(project)?.list?.() || [];
  } catch {
    mcps = [];
  }
  const own = mcps.filter((m) => m.enabled !== false && m.source !== "global");
  const shared = mcps.filter((m) => m.enabled !== false && m.source === "global");
  if (own.length || shared.length || globalMcps.length) {
    lines.push("", "## MCP servers you can use here (via `call_mcp`)");
    for (const m of own) lines.push(`- ${describeMcpLine(m)} [project]`);
    for (const m of shared.length ? shared : globalMcps) lines.push(`- ${describeMcpLine(m)}`);
  }

  if (includeAgentsMd) {
    const text = readText(agentsMdFile(root)).trim();
    if (text) lines.push("", "## Project rules (AGENTS.md) — follow them", "", capText(text, agentsMdMaxChars));
  }
  const nested = listNestedAgentsFiles(root);
  if (nested.length) {
    lines.push(
      "",
      "## Folder rules",
      "These folders carry their own AGENTS.md. Before acting on anything inside one of them — above all anything that leaves the machine (publishing, sending, deploying) — read it; it is also attached automatically the first time a tool touches that folder.",
      ...nested.map((rel) => `- \`${rel}\``)
    );
  }

  const localMem = project.storagePath || project.storage_path
    ? readText(path.join(project.storagePath || project.storage_path, "memory.md"))
    : "";
  const curated = readText(apcMemoryFile(root));
  const core = [memoryCore(curated, memoryMaxChars), memoryCore(localMem, memoryMaxChars)].filter(Boolean).join("\n\n");
  if (core) lines.push("", "## Project memory (durable facts)", "", core);

  return lines.join("\n");
}

/**
 * AGENTS.md files between a project root (exclusive) and `dir` (inclusive),
 * root-most first, skipping any in `seen` — and adding what it returns to it.
 */
export function directoryRulesFor(root, dir, seen = new Set(), { maxChars = 8000 } = {}) {
  if (!root || !dir) return [];
  const r = path.resolve(root);
  let d = path.resolve(dir);
  if (d !== r && !d.startsWith(r + path.sep)) return [];
  const chain = [];
  while (d !== r && d.startsWith(r + path.sep)) {
    chain.unshift(d);
    d = path.dirname(d);
  }
  const out = [];
  for (const folder of chain) {
    const file = path.join(folder, AGENTS_MD);
    if (seen.has(file)) continue;
    const text = readText(file).trim();
    if (!text) continue;
    seen.add(file);
    out.push({ path: path.relative(r, file), content: capText(text, maxChars) });
  }
  return out;
}

/**
 * What a project AGENT needs of its own project on every turn: the root
 * AGENTS.md, the folders with their own rules, and the durable core of the
 * project memory. Its prompt used to carry its role and its own memory only —
 * the worker that knows the repo started without the repo's contract.
 */
export function buildProjectContractBlock(project, { agentsMdMaxChars = 12000, memoryMaxChars = 3000 } = {}) {
  const root = project?.path;
  if (!root) return "";
  const parts = [`# Your project: ${project.name || path.basename(root)} (\`${root}\`)`, "File and shell tools resolve relative to this root."];
  const rules = readText(agentsMdFile(root)).trim();
  if (rules) parts.push("", "## Project rules (AGENTS.md) — follow them", "", capText(rules, agentsMdMaxChars));
  const nested = listNestedAgentsFiles(root);
  if (nested.length) {
    parts.push("", "## Folder rules", "Read the one for a folder before acting inside it (it is also attached the first time a tool touches that folder):", ...nested.map((rel) => `- \`${rel}\``));
  }
  const store = project.storagePath || project.storage_path;
  const core = [memoryCore(readText(apcMemoryFile(root)), memoryMaxChars), store ? memoryCore(readText(path.join(store, "memory.md")), memoryMaxChars) : ""]
    .filter(Boolean)
    .join("\n\n");
  if (core) parts.push("", "## Project memory (durable facts)", "", core);
  return parts.join("\n");
}
