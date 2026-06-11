// Filesystem layout of an APC project. The `.apc/` folder is APX's footprint
// inside someone else's repo — everything that the daemon writes to a
// user-checked-out project lives here, plus the top-level AGENTS.md spec.
//
// Use the helpers below instead of joining the literal names yourself. A typo
// in `".apc"` or `"project.json"` will silently create an orphan tree instead
// of failing loud, which is exactly the bug class these constants prevent.
import fs from "node:fs";
import path from "node:path";

// Raw names — exported for the rare caller that needs to glob/match by name.
export const APC_DIR = ".apc";
export const APC_PROJECT_FILE = "project.json";
export const APC_PROJECT_CONFIG_FILE = "config.json";
export const APC_PROJECT_MEMORY_FILE = "memory.md";
export const APC_AGENTS_DIR = "agents";
export const APC_SKILLS_DIR = "skills";
export const APC_COMMANDS_DIR = "commands";
export const APC_NOTES_DIR = "notes";
export const APC_MCPS_FILE = "mcps.json";
export const APC_REMOVED_FILE = ".removed.json";
export const AGENTS_MD = "AGENTS.md";

// Path builders. `root` is the project root (the directory that contains
// `.apc/` and `AGENTS.md`).
export function apcDir(root) {
  return path.join(root, APC_DIR);
}

export function apcProjectFile(root) {
  return path.join(root, APC_DIR, APC_PROJECT_FILE);
}

export function apcProjectConfigFile(root) {
  return path.join(root, APC_DIR, APC_PROJECT_CONFIG_FILE);
}

export function apcAgentsDir(root) {
  return path.join(root, APC_DIR, APC_AGENTS_DIR);
}

export function apcAgentFile(root, slug) {
  return path.join(root, APC_DIR, APC_AGENTS_DIR, `${slug}.md`);
}

export function apcAgentMemoryFile(root, slug) {
  return path.join(root, APC_DIR, APC_AGENTS_DIR, slug, "memory.md");
}

export function apcRemovedFile(root) {
  return path.join(root, APC_DIR, APC_AGENTS_DIR, APC_REMOVED_FILE);
}

export function apcSkillsDir(root) {
  return path.join(root, APC_DIR, APC_SKILLS_DIR);
}

export function apcSkillFile(root, slug) {
  return path.join(root, APC_DIR, APC_SKILLS_DIR, `${slug}.md`);
}

export function apcCommandsDir(root) {
  return path.join(root, APC_DIR, APC_COMMANDS_DIR);
}

export function apcNotesDir(root) {
  return path.join(root, APC_DIR, APC_NOTES_DIR);
}

// Project-level memory (super-agent / project-wide), distinct from the
// per-agent memory.md that lives under .apc/agents/<slug>/.
export function apcMemoryFile(root) {
  return path.join(root, APC_DIR, APC_PROJECT_MEMORY_FILE);
}

export function apcMcpsFile(root) {
  return path.join(root, APC_DIR, APC_MCPS_FILE);
}

export function agentsMdFile(root) {
  return path.join(root, AGENTS_MD);
}

// True when `root` looks like an initialized APC project (has the marker file).
export function isApcProject(root) {
  return fs.existsSync(apcProjectFile(root));
}
