// After a turn: did the owner just state a standing rule or preference that
// belongs in memory's Core? Hermes forks a reviewer after every turn for this;
// here it is narrower on purpose. It only runs when the owner's own message
// carries a rule-shaped cue, it asks a cheap model, and it writes at most two
// facts, deduplicated against what Core already holds. The reply to the owner
// never waits on it.
//
// Why it exists: `remember` depends on the model choosing to call it, and on a
// busy turn it does not. "Posts go out at 18:00, never published on the spot"
// was said more than once and never reached anything that ships every turn.
import { callEngine } from "#core/engines/index.js";
import { resolveCompactModels } from "#core/memory/summarizer.js";
import { readSelfCoreFacts, addSelfCoreFact } from "#core/agent/self-memory.js";
import { addProjectCoreFact, readProjectLocalMemory } from "#core/stores/project-memory.js";
import { readCoreFacts } from "#core/memory/dated-log.js";

// Words an owner uses when they set a rule, not when they ask for a thing.
const RULE_CUES = /\b(siempre|nunca|jam[aá]s|a partir de ahora|de ahora en m[aá]s|prefiero|no quiero|quiero que|record[aá]|acordate|acu[eé]rdate|la regla|regla|por defecto|always|never|from now on|i prefer|don't ever|do not ever|remember that|the rule|by default)\b/i;

export function turnWorthReviewing(userText) {
  const t = String(userText || "").trim();
  return t.length >= 15 && RULE_CUES.test(t);
}

const REVIEW_SYSTEM =
  "You maintain an assistant's standing memory. You extract ONLY durable rules, preferences or facts " +
  "the OWNER stated or clearly decided in this exchange. Output strict JSON and nothing else.";

export function buildReviewPrompt({ userText, replyText, coreGlobal = [], coreProject = [], projectName = "" }) {
  return [
    "Owner's message:",
    `"""${String(userText).slice(0, 2000)}"""`,
    "",
    "Assistant's reply:",
    `"""${String(replyText || "").slice(0, 1200)}"""`,
    "",
    "Already remembered (do NOT repeat or rephrase these):",
    ...[...coreGlobal, ...coreProject].map((f) => `- ${f}`),
    "",
    `Return {"facts":[{"scope":"global"|"project","text":"..."}]} with AT MOST 2 facts.`,
    "- Only what the OWNER stated as a standing rule/preference/fact — not tasks, not one-off requests, not what the assistant did.",
    `- scope "project" only if it is about the project${projectName ? ` "${projectName}"` : ""} under discussion; otherwise "global".`,
    "- Each text: one declarative sentence in the owner's language (\"Posts are scheduled at 18:00\", not \"Always schedule\").",
    '- Nothing durable → {"facts":[]}.',
  ].join("\n");
}

export function parseReview(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const facts = JSON.parse(m[0])?.facts;
    if (!Array.isArray(facts)) return [];
    return facts
      .filter((f) => f && typeof f.text === "string" && f.text.trim().length >= 8 && f.text.length <= 300)
      .slice(0, 2)
      .map((f) => ({ scope: f.scope === "project" ? "project" : "global", text: f.text.trim() }));
  } catch {
    return [];
  }
}

/**
 * Review one finished owner turn. Resolves to the facts written ([] when the
 * turn had no cue, the model found nothing, or anything failed). Never throws.
 */
export async function reviewTurnForMemory({
  userText,
  replyText,
  project = null,
  config = {},
  log = () => {},
  callEngineFn = callEngine,
} = {}) {
  try {
    if (config?.memory?.auto_review === false || !turnWorthReviewing(userText)) return [];
    const coreGlobal = readSelfCoreFacts();
    const coreProject = project ? readCoreFacts(readProjectLocalMemory(project)) : [];
    const prompt = buildReviewPrompt({ userText, replyText, coreGlobal, coreProject, projectName: project?.name || "" });
    const models = resolveCompactModels(config);
    const chain = [...new Set([config?.memory?.review_model, models.primary, models.fallback, models.last].filter(Boolean))];
    let facts = null;
    for (const modelId of chain) {
      try {
        const r = await callEngineFn({
          modelId,
          system: REVIEW_SYSTEM,
          messages: [{ role: "user", content: prompt }],
          config,
          maxTokens: 800,
          temperature: 0,
        });
        facts = parseReview(r?.text);
        break;
      } catch (e) {
        log(`memory review: ${modelId} failed — ${e?.message || e}`);
      }
    }
    const written = [];
    for (const f of facts || []) {
      const r = f.scope === "project" && project
        ? addProjectCoreFact(project, f.text, { projectName: project.name || "" })
        : addSelfCoreFact(f.text);
      if (r.added) written.push(f);
    }
    if (written.length) log(`memory review: saved ${written.length} standing fact(s) to Core`);
    return written;
  } catch {
    return [];
  }
}
