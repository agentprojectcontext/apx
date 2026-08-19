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
// room than the old ~800-token narrative recap — and the budget has to cover
// the model's THINKING too. A reasoner spends a chain of thought before it
// writes a word: at 1200 the reasoning ate the budget and the summary came back
// cut off mid-section, which is the one failure mode this whole file exists to
// avoid. ~900 tokens of summary + room to think.
export const COMPACT_MAX_TOKENS = 3200;

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

// A compact record REPLACES the raw turns it covers — the reader drops them and
// keeps only this text. So a summary that came back truncated, empty-ish, or
// stripped of its sections is not a degraded summary: it is amnesia written to
// disk, permanently, for every turn it covered. It has happened in production —
// one flaky response wrote `"USER_CONTEXT:\n- Manu"` over 350 turns and the
// agent spent the rest of the day re-deriving what it already knew.
//
// So a summary has to earn the right to stand in for the history:
const MIN_SUMMARY_CHARS = 400;
// …and at least this many of the labelled sections it was asked for, otherwise
// the model answered with prose or stopped mid-header.
const MIN_SUMMARY_SECTIONS = 2;
// A threaded summary must SUBSUME the previous one. Coming back at a fraction
// of its size means state was dropped, not condensed.
const PREV_SUMMARY_FLOOR = 0.5;

// A section header opens a line: optional markdown bullet/heading marks, the
// label, a colon. What follows on the line is free — real summaries put the
// bullets underneath, but a one-line "LABEL: value" is still a section.
const SECTION_RE =
  /^[ \t]*[-*#>\s]*(USER_CONTEXT|TASK_TRACKING|COMPLETED|PENDING|CURRENT_STATE|CODE_STATE|TESTS|CHANGES|DEPS|VERSION_CONTROL_STATUS)[ \t]*:/gim;

/** How many labelled sections a summary actually carries. */
export function countSummarySections(text) {
  const seen = new Set();
  for (const m of String(text || "").matchAll(SECTION_RE)) seen.add(m[1].toUpperCase());
  return seen.size;
}

/**
 * Is this text fit to REPLACE the turns it covers? Returns null when usable,
 * else a short reason (for the log — a silent reject is undiagnosable).
 */
export function summaryRejectReason(text, { prevSummary = "" } = {}) {
  const t = String(text || "").trim();
  if (!t) return "empty";
  if (t.length < MIN_SUMMARY_CHARS) return `too short (${t.length} chars)`;
  const sections = countSummarySections(t);
  if (sections < MIN_SUMMARY_SECTIONS) return `only ${sections} section(s)`;
  const prev = String(prevSummary || "").trim();
  if (prev && t.length < prev.length * PREV_SUMMARY_FLOOR) {
    return `shrank past the previous summary (${t.length} vs ${prev.length} chars)`;
  }
  return null;
}

/**
 * Run the summarizer over a prompt, walking the model chain. Returns
 * { text, model } or null when no model produced a USABLE summary (caller
 * decides what a null means — skip compaction, keep raw history, etc.).
 *
 * `prevSummary` is the summary this one is meant to subsume; it is used only to
 * validate that the new text did not lose it.
 */
export async function summarizeStructured({
  prompt,
  models,
  config,
  maxTokens = COMPACT_MAX_TOKENS,
  prevSummary = "",
  onReject = null,
}) {
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
      const reject = summaryRejectReason(text, { prevSummary });
      if (!reject) return { text, model: modelId };
      if (typeof onReject === "function") onReject({ model: modelId, reason: reject, text });
    } catch (e) {
      if (typeof onReject === "function") {
        onReject({ model: modelId, reason: `engine error: ${e?.message || e}`, text: "" });
      }
    }
  }
  return null;
}
