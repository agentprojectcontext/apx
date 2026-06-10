import fs from "node:fs";
import path from "node:path";
import { projectStorageRoot } from "../config.js";
import { getOrCreateApxId } from "../scaffold.js";

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

export function legacyAgentMemoryPath(projectRoot, slug) {
  return path.join(projectRoot, ".apc", "agents", slug, "memory.md");
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
  const primary = agentMemoryPath(projectOrRoot, slug);
  if (fs.existsSync(primary)) return fs.readFileSync(primary, "utf8");

  const root =
    typeof projectOrRoot === "string"
      ? projectOrRoot
      : projectOrRoot?.path;
  if (root) {
    const legacy = legacyAgentMemoryPath(root, slug);
    if (fs.existsSync(legacy)) return fs.readFileSync(legacy, "utf8");
  }

  return "";
}

export function writeAgentMemory(projectOrRoot, slug, body) {
  ensureAgentRuntimeDir(projectOrRoot, slug);
  const memory = agentMemoryPath(projectOrRoot, slug);
  fs.writeFileSync(memory, body);
  return memory;
}
