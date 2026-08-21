// A project agent's durable memory. ONE location, no second candidate:
//
//   ~/.apx/projects/<apx_id>/agents/<slug>/memory.md
//
// It is runtime state, so it lives in the APX home and never inside the user's
// repo. `.apc/` is the committed half of a project (agent definitions, skills,
// curated project memory) and an agent's memory is none of those: it is written
// by the agent itself, turn after turn, and nobody reviews it before it lands.
// An older layout wrote it to `.apc/agents/<slug>/memory.md`; that path is gone
// on purpose — two candidate files means half the writes land where the next
// read does not look.
import fs from "node:fs";
import path from "node:path";
import { projectStorageRoot } from "../config/index.js";
import { getOrCreateApxId } from "../apc/scaffold.js";

const EMPTY_MEMORY = (slug) =>
  `# Memory — ${slug}\n\n` +
  `## Identity\n- \n\n` +
  `## Long-term facts\n- \n\n` +
  `## Recent context\n- \n`;

export function agentRuntimeDir(projectOrRoot, slug) {
  const storagePath =
    typeof projectOrRoot === "object" && projectOrRoot?.storagePath
      ? projectOrRoot.storagePath
      : null;
  const root =
    typeof projectOrRoot === "string"
      ? projectOrRoot
      : projectOrRoot?.path;
  const base = storagePath || projectStorageRoot(getOrCreateApxId(root));
  return path.join(base, "agents", slug);
}

export function agentMemoryPath(projectOrRoot, slug) {
  return path.join(agentRuntimeDir(projectOrRoot, slug), "memory.md");
}

export function ensureAgentRuntimeDir(projectOrRoot, slug, { createMemory = false } = {}) {
  const dir = agentRuntimeDir(projectOrRoot, slug);
  fs.mkdirSync(dir, { recursive: true });
  if (createMemory) {
    const memory = path.join(dir, "memory.md");
    if (!fs.existsSync(memory)) fs.writeFileSync(memory, EMPTY_MEMORY(slug));
  }
  return dir;
}

export function readAgentMemory(projectOrRoot, slug) {
  const file = agentMemoryPath(projectOrRoot, slug);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

export function writeAgentMemory(projectOrRoot, slug, body) {
  ensureAgentRuntimeDir(projectOrRoot, slug);
  const memory = agentMemoryPath(projectOrRoot, slug);
  fs.writeFileSync(memory, body);
  return memory;
}

// Append a dated note under the "## Recent context" section, creating the file
// (and the section) if missing. ONE home for the append convention so the CLI
// (`apx memory <slug> --append`) and the super-agent's `write_agent_memory` tool
// stamp memory identically. `now` is injectable so tests can pin the date.
export function appendAgentMemory(projectOrRoot, slug, note, { now = new Date() } = {}) {
  ensureAgentRuntimeDir(projectOrRoot, slug);
  const text = String(note || "").trim();
  if (!text) throw new Error("note required");
  let body = readAgentMemory(projectOrRoot, slug);
  if (!body) body = EMPTY_MEMORY(slug);
  if (!/##\s+Recent context/i.test(body)) {
    body += body.endsWith("\n") ? "\n## Recent context\n" : "\n\n## Recent context\n";
  }
  const today = now.toISOString().slice(0, 10);
  body = body.replace(/(##\s+Recent context\s*\n)/i, `$1- ${today}: ${text}\n`);
  return writeAgentMemory(projectOrRoot, slug, body);
}
