// Suggest a skill semantically when the user prompt looks like it would
// benefit from one — without paying the catalog's token cost every turn.
//
// On every turn we:
//   1. Embed the user prompt.
//   2. Embed each skill's condensed description (cached per-process by slug).
//   3. Pick the top match if its cosine ≥ THRESHOLD AND noticeably better
//      than the runner-up (so a vague prompt doesn't drag a random skill in).
//   4. Return a SOFT HINT block — not a full skill body — that nudges the
//      model to call `load_skill({slug})` if the gist matches.
//
// Soft, not hard:
//   - We never inject the body; the model still has to decide and call.
//   - We never block the request: any embedding error → "" return.
//   - We never re-call the indexer; the embedder is the same one already
//     selected by core/memory/embeddings.js.
//
// Costs: one extra embedOne(promptText) per turn. Skill description
// embeddings are cached in-process by (slug, source) so the cold cost is
// O(skills) once per process start.
import { embedOne, cosineSim } from "#core/memory/embeddings.js";
import { condenseSkillDescription } from "#core/agent/skills/index.js";
import { listSkills } from "./loader.js";

const SIM_THRESHOLD = 0.45;        // below this, no suggestion
const MARGIN = 0.05;               // top must beat runner-up by at least this
const PROMPT_LEN_FLOOR = 8;        // skip "hola" / "ok" / single-word prompts

const cache = new Map();           // slug -> { vector, descHash }

function descHash(text) {
  let h = 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

async function ensureSkillVector(skill, opts) {
  const desc = condenseSkillDescription(skill.description);
  const h = descHash(desc);
  const hit = cache.get(skill.slug);
  if (hit && hit.descHash === h) return hit.vector;
  const vector = await embedOne(desc, opts);
  if (vector) cache.set(skill.slug, { vector, descHash: h });
  return vector;
}

/**
 * Returns "" when no confident match exists, or a one-paragraph hint that
 * names the slug + the matched description. Callers append it to contextNote.
 */
export async function suggestSkillForPrompt(prompt, { projectPath, embedOpts } = {}) {
  try {
    const p = String(prompt || "").trim();
    if (p.length < PROMPT_LEN_FLOOR) return "";

    const skills = listSkills({ projectPath });
    if (!skills.length) return "";

    const promptVec = await embedOne(p, embedOpts);
    if (!promptVec) return "";

    const scored = [];
    for (const skill of skills) {
      const v = await ensureSkillVector(skill, embedOpts);
      if (!v) continue;
      scored.push({ slug: skill.slug, sim: cosineSim(promptVec, v) });
    }
    if (scored.length === 0) return "";
    scored.sort((a, b) => b.sim - a.sim);

    const top = scored[0];
    const runner = scored[1] || { sim: 0 };
    if (top.sim < SIM_THRESHOLD) return "";
    if (top.sim - runner.sim < MARGIN) return "";

    return [
      "# Skill semantically relevant to this prompt",
      `The skill \`${top.slug}\` matches what the user is asking about (sim ${top.sim.toFixed(2)}).`,
      "If exact syntax/behaviour for that skill is needed, call `load_skill({slug:\"" + top.slug + "\"})`",
      "BEFORE answering. If the user's question is actually about something else, ignore this hint.",
    ].join("\n");
  } catch {
    return "";
  }
}

// Exposed for tests / cache hygiene if a caller wants to reset between runs.
export function clearSkillVectorCache() {
  cache.clear();
}
