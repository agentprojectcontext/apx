// Sync apc-context skill from canonical APC sources (never owned by APX repo).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname is src/core/apc/ after the Phase 3 move (was src/core/ before).
// Repo root is three levels up, not two.
export const PACKAGE_ROOT = path.resolve(__dirname, "..", "..", "..");

// Engine-side slim copy (replicated to ~/.<host>/skills/ by apx skills sync).
export const APC_SKILL_REL = path.join("skills", "apc-context", "SKILL.md");
// Runtime-internal copy (loaded by the super-agent — never published outside).
export const APC_BUILTIN_SKILL_REL = path.join("src", "core", "runtime-skills", "apc-context", "SKILL.md");
export const APC_SKILL_REMOTE =
  "https://raw.githubusercontent.com/agentprojectcontext/agentprojectcontext/main/skills/apc-context/SKILL.md";

export const APC_SKILL_SIBLINGS = [
  path.resolve(PACKAGE_ROOT, "..", "apc", "skills", "apc-context", "SKILL.md"),
  path.resolve(PACKAGE_ROOT, "..", "agentprojectcontext", "skills", "apc-context", "SKILL.md"),
];

export function apcSkillDest(packageRoot = PACKAGE_ROOT) {
  return path.join(packageRoot, APC_SKILL_REL);
}

export function looksLikeApcContextSkill(text) {
  return typeof text === "string"
    && text.startsWith("---")
    && /name:\s*apc-context/.test(text);
}

export function readApcContextSkill({ packageRoot = PACKAGE_ROOT } = {}) {
  const dest = apcSkillDest(packageRoot);
  if (fs.existsSync(dest)) {
    const text = fs.readFileSync(dest, "utf8");
    if (looksLikeApcContextSkill(text)) return { text, source: dest };
  }
  for (const candidate of APC_SKILL_SIBLINGS) {
    if (!fs.existsSync(candidate)) continue;
    const text = fs.readFileSync(candidate, "utf8");
    if (looksLikeApcContextSkill(text)) return { text, source: candidate };
  }
  return null;
}

async function fetchRemote(timeoutMs = 5000) {
  const fetchImpl = globalThis.fetch || (await import("node-fetch")).default;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(APC_SKILL_REMOTE, { signal: ac.signal });
    if (!res.ok) return null;
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refresh skills/apc-context/SKILL.md from APC canonical source.
 * Non-fatal: returns { ok, source, reason }.
 */
export async function refreshApcContextSkill({ packageRoot = PACKAGE_ROOT, timeoutMs = 5000 } = {}) {
  const dest = apcSkillDest(packageRoot);
  let text = null;
  let source = "unknown";

  for (const candidate of APC_SKILL_SIBLINGS) {
    if (!fs.existsSync(candidate)) continue;
    const t = fs.readFileSync(candidate, "utf8");
    if (looksLikeApcContextSkill(t)) {
      text = t;
      source = candidate;
      break;
    }
  }

  if (!text) {
    try {
      const t = await fetchRemote(timeoutMs);
      if (looksLikeApcContextSkill(t)) {
        text = t;
        source = APC_SKILL_REMOTE;
      }
    } catch {
      // fall through
    }
  }

  if (!text) {
    const existing = readApcContextSkill({ packageRoot });
    if (existing) {
      return { ok: true, source: existing.source, refreshed: false, reason: "kept-existing" };
    }
    return { ok: false, source: null, refreshed: false, reason: "no-source" };
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text, "utf8");

  // Keep the runtime-internal copy (src/core/runtime-skills/apc-context/) in
  // sync — that's where the super-agent loads it from.
  const builtinDest = path.join(packageRoot, APC_BUILTIN_SKILL_REL);
  fs.mkdirSync(path.dirname(builtinDest), { recursive: true });
  fs.writeFileSync(builtinDest, text, "utf8");

  return { ok: true, source, refreshed: true };
}
