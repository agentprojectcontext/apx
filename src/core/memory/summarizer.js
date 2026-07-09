// Structured-state summarizer — the ONE summarization service (condenser v2).
//
// Both compaction entry points share this brain so summaries are identical in
// quality no matter how they were triggered:
//   - automatic: core/memory/compactor.js over the rolling cross-channel log
//   - on demand:  core/stores/conversations-compactor.js (apx session compact,
//                 the web "compact" button, POST …/compact)
// Different STORES, different triggers, ONE summarizer. Don't add a third.
//
// Mechanics ported from OpenHands' LLMSummarizingCondenser: a structured state
// (not a narrative recap) plus previous-summary threading for continuity.

import { callEngine } from "../engines/index.js";

// Structured state summaries carry several labelled sections, so they need more
// room than the old ~800-token narrative recap.
export const COMPACT_MAX_TOKENS = 1200;

export const CONDENSER_SYSTEM =
  "You are maintaining a context-aware state summary for an interactive agent. " +
  "Another model will read your summary to continue the work: be dense, factual, and structured.";

// The instructions live in the USER prompt (not the system prompt) so offline
// tests can capture the full instruction set through the echoing mock engine.
const CONDENSER_INSTRUCTIONS = `You will be given a list of events from an agent conversation as <EVENT> blocks. If the first event is a PREVIOUS STATE SUMMARY, your new summary must fully subsume it — carry forward all still-relevant state.

Maintain this structured state, one section per line group:

USER_CONTEXT: (essential user requirements, goals, and clarifications, in concise form)
TASK_TRACKING: (active tasks and their statuses; preserve exact task IDs)
COMPLETED: (tasks completed so far, with brief results)
PENDING: (tasks that still need to be done)
CURRENT_STATE: (current variables, data structures, or other relevant state)

For code-related tasks, also maintain:
CODE_STATE: (file paths, function signatures, data structures)
TESTS: (failing cases, error messages, outputs)
CHANGES: (code edits and their effects)
DEPS: (dependencies, imports, external calls)
VERSION_CONTROL_STATUS: (repository state, current branch, PR status, commits)

PRIORITIZE:
1. Adapt the format to the actual task type — omit sections that do not apply.
2. Capture key user requirements and goals.
3. Distinguish completed work from pending work.
4. Keep every section concise and relevant.

SKIP: greetings, meta-commentary, failed operations without semantic importance, repetitive details.

Output ONLY the summary sections (max ~900 tokens).`;

/**
 * Resolve the compaction model chain. Primary: a light, local-endpoint model
 * (Ollama, incl. *-cloud served via localhost). Fallback: whatever the user
 * configured, else the APX default super-agent model — never silently a paid
 * service the user didn't pick. A blank fallback resolves at call time.
 */
export function resolveCompactModels(config = {}) {
  const mem = config.memory || {};
  return {
    primary: mem.compact_model || "ollama:gemma4:31b-cloud",
    fallback: mem.compact_fallback_model || config.super_agent?.model || "",
  };
}

/**
 * Render a normalized turn list into `<EVENT>` blocks. Items:
 *   { role: "user"|"assistant"|"tool", content: string, name?: string }
 * `prevSummary` (if any) rides along as EVENT id=0 role=summary so the new
 * summary subsumes it (continuity across compactions).
 */
export function renderEvents(items, { prevSummary = "" } = {}) {
  const events = [];
  if (prevSummary && String(prevSummary).trim()) {
    events.push(
      `<EVENT id=0 role=summary>\n[PREVIOUS STATE SUMMARY]\n${String(prevSummary).trim()}\n</EVENT>`
    );
  }
  for (const it of items) {
    const id = events.length;
    if (it.role === "tool") {
      const name = it.name || "tool";
      events.push(`<EVENT id=${id} role=tool name=${name}>\n${String(it.content || "").slice(0, 600)}\n</EVENT>`);
    } else {
      const role = it.role === "user" ? "user" : "assistant";
      events.push(`<EVENT id=${id} role=${role}>\n${String(it.content || "")}\n</EVENT>`);
    }
  }
  return events.join("\n\n");
}

/** Assemble the full user prompt (opening verbatim block + events). */
export function buildCondenserPrompt({ eventsBlock, openingBlock = "" }) {
  const opening = openingBlock
    ? "The following opening turns of the conversation are quoted verbatim. They carry the ORIGINAL GOAL — preserve their intent (near-verbatim) under USER_CONTEXT:\n\n" +
      `<CONVERSATION_OPENING>\n${openingBlock}\n</CONVERSATION_OPENING>\n\n`
    : "";
  return `${CONDENSER_INSTRUCTIONS}\n\n${opening}${eventsBlock}`;
}

/**
 * Run the summarizer over a prompt, walking the model chain. Returns
 * { text, model } or null when no model produced text (caller decides what a
 * null means — skip compaction, keep raw history, etc.).
 */
export async function summarizeStructured({ prompt, models, config, maxTokens = COMPACT_MAX_TOKENS }) {
  for (const modelId of [models.primary, models.fallback]) {
    if (!modelId) continue;
    try {
      const r = await callEngine({
        modelId,
        system: CONDENSER_SYSTEM,
        messages: [{ role: "user", content: prompt }],
        config,
        maxTokens,
        temperature: 0.2,
      });
      const text = String(r.text || "").trim();
      if (text) return { text, model: modelId };
    } catch {
      /* try next model */
    }
  }
  return null;
}
