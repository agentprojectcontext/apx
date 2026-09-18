// The per-turn skill decision, for every surface that runs a super-agent turn.
//
// There are four of them — the daemon's streaming endpoint, its blocking one,
// the Telegram channel and the WhatsApp channel — and until now only the two
// HTTP ones ran the inspector. The channels called runSuperAgent() directly, so
// on Telegram and WhatsApp the per-turn skill RAG did not exist: no injection,
// no suggestion, no trace, nothing in the ledger to explain the absence. The
// same question answered on the web and on Telegram got two different prompts,
// and only one of them had the matching skill in it.
//
// This module is the one place that decision is made, so a new surface inherits
// it by calling one function instead of by remembering to.
//
// It returns everything a caller needs and nothing it has to interpret:
//   contextNote   — append to whatever context the surface already built
//   trace         — for the `skill_inspector` event / ledger row (may be null)
//   skipSkillsHint— pass straight through to runSuperAgent()
import {
  inspectPromptForSkills,
  isInspectorEnabled,
  shouldKeepSkillsHint,
} from "./inspector.js";
import { suggestSkillForPrompt } from "./rag.js";

/**
 * @param {object} args
 * @param {string} args.prompt         the user's message for THIS turn
 * @param {string=} args.projectPath   project root (project skills shadow global)
 * @param {object=} args.globalConfig  the daemon config
 * @returns {Promise<{contextNote:string, trace:object|null, skipSkillsHint:boolean}>}
 */
export async function resolveTurnSkills({ prompt, projectPath, globalConfig } = {}) {
  const none = { contextNote: "", trace: null, skipSkillsHint: false };
  const text = String(prompt || "").trim();
  if (!text) return none;

  // Inspector off → the passive nudge, which only ever suggests and never
  // removes the catalog. Same behaviour as before this module existed.
  if (!isInspectorEnabled(globalConfig)) {
    try {
      const hint = await suggestSkillForPrompt(text, { projectPath });
      return { contextNote: hint || "", trace: null, skipSkillsHint: false };
    } catch {
      return none;
    }
  }

  try {
    const out = await inspectPromptForSkills({ prompt: text, projectPath, globalConfig });
    return {
      contextNote: out.contextNote || "",
      trace: out.trace || null,
      skipSkillsHint: !shouldKeepSkillsHint(out.trace),
    };
  } catch {
    // An inspector failure must never block a turn, and must never cost the
    // agent its catalog on the way down.
    return none;
  }
}

/** Merge a resolved note onto whatever the surface already had. */
export function mergeContextNote(existing, note) {
  return [existing, note].filter(Boolean).join("\n\n");
}
