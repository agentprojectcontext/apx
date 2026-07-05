// Skill Inspector — middleware that mutates the chat each turn so the agent
// only ever sees the skills it actually needs.
//
// Design goals (test feature, opt-in via config.skills.inspector.enabled):
//   1. NO static slug dump. The "Available skills" hint block listing every
//      slug in the catalog is suppressed when the inspector is on — the agent
//      reaches skills via this middleware and the existing load_skill tool.
//   2. Per-turn re-evaluation. The decision is recomputed from the current
//      user prompt; a skill that matched last turn but not this one simply
//      disappears from the next system prompt — natural decay.
//   3. Two tiers based on confidence:
//        - LOAD  (sim ≥ load_threshold): the body is inlined as contextNote.
//          The agent has it right there — no extra tool call.
//        - HINT  (sim ≥ hint_threshold): only the slug + one-line description
//          is named, and the agent is told to call load_skill if it actually
//          needs the syntax.
//      Below hint_threshold → nothing.
//   4. Local-first. Uses the same embeddings chain as cross-channel memory
//      (ollama → gemini → openai → tf). With no provider, the offline TF
//      fallback runs — works on any machine, zero API key, zero GPU.
//   5. Never block the request. Any embedding failure → empty contextNote.
//
// Returns a structured trace so the daemon can emit `skill_inspector` events
// to the stream (handy for the web debug panel and CLI inspect).

import { embedOne, cosineSim } from "#core/memory/embeddings.js";
import { listSkills, loadSkill } from "./loader.js";
import { filterEnabledSkills, isSkillEnabled } from "./policy.js";
import { readIndex, backgroundRefreshIfStale } from "./index-store.js";

// Defaults — exported so the CLI/web can render them.
export const INSPECTOR_DEFAULTS = Object.freeze({
  enabled: false,             // OPT-IN — this is a test feature.
  load_threshold: 0.55,       // sim ≥ this → inline body
  hint_threshold: 0.40,       // sim ≥ this → just hint
  margin: 0.04,               // top must beat runner-up by this for confident pick
  max_loaded: 1,              // how many bodies to inline at once
  max_hints: 2,               // how many additional hints to add
  prompt_floor: 8,            // skip super-short prompts ("ok", "hola")
  body_char_cap: 6000,        // hard cap on inlined skill bodies (token guard)
});

function effectiveConfig(globalConfig) {
  const raw = globalConfig?.skills?.inspector || {};
  return { ...INSPECTOR_DEFAULTS, ...raw };
}

/** Quick public probe so the daemon/api can decide whether to suppress the
 *  static hint block in the system prompt. */
export function isInspectorEnabled(globalConfig) {
  return effectiveConfig(globalConfig).enabled === true;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreAgainstIndex(promptVec, indexItems) {
  const out = [];
  for (const slug of Object.keys(indexItems)) {
    const it = indexItems[slug];
    if (!Array.isArray(it.desc_vector)) continue;
    out.push({
      slug,
      source: it.source,
      desc: it.desc || "",
      file: it.file,
      sim: cosineSim(promptVec, it.desc_vector),
    });
  }
  out.sort((a, b) => b.sim - a.sim);
  return out;
}

// ---------------------------------------------------------------------------
// Context block rendering
// ---------------------------------------------------------------------------

function renderInjectedBlock({ loaded, hinted, embedder }) {
  if (loaded.length === 0 && hinted.length === 0) return "";

  const lines = [
    "# Skill Inspector",
    `Local RAG (${embedder}) matched the user's prompt against your skill catalog.`,
    "The catalog itself is NOT in your system prompt — only what's below is.",
    "If none of these is right, call `list_skills` to browse and `load_skill` to fetch one.",
    "",
  ];

  if (loaded.length) {
    lines.push("## Loaded for this turn");
    for (const s of loaded) {
      lines.push("");
      lines.push(`### \`${s.slug}\`  (sim ${s.sim.toFixed(2)}, source: ${s.source})`);
      lines.push(s.body);
    }
    lines.push("");
  }

  if (hinted.length) {
    lines.push("## Possibly relevant — load on demand");
    for (const s of hinted) {
      lines.push(`- \`${s.slug}\` — sim ${s.sim.toFixed(2)}. ${s.desc}`);
    }
    lines.push("");
    lines.push("Call `load_skill({slug:\"…\"})` for any of these BEFORE answering if you need its exact syntax.");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

/**
 * Decide what skill context (if any) to inject for this turn.
 *
 * @param {object} args
 * @param {string} args.prompt          the user's current message
 * @param {string=} args.projectPath    project root (project skills shadow global)
 * @param {object=} args.globalConfig   passed through to embedOne()
 * @param {object=} args.embedOpts      optional embedOne overrides
 *
 * @returns {{
 *   contextNote: string,
 *   trace: {
 *     enabled: boolean,
 *     reason?: string,
 *     embedder?: string,
 *     scored?: Array<{slug, sim}>,
 *     loaded?: string[],
 *     hinted?: string[],
 *   }
 * }}
 */
export async function inspectPromptForSkills({ prompt, projectPath, globalConfig, embedOpts } = {}) {
  const cfg = effectiveConfig(globalConfig);
  if (!cfg.enabled) {
    return { contextNote: "", trace: { enabled: false, reason: "disabled" } };
  }

  const text = String(prompt || "").trim();
  if (text.length < cfg.prompt_floor) {
    return { contextNote: "", trace: { enabled: true, reason: "prompt_too_short" } };
  }

  // Self-heal: if a skill was added/edited/removed since the last index, kick a
  // background rebuild. Non-blocking — this turn uses whatever is already on
  // disk; the next turn picks up the fresh vectors. This is what lets a user
  // drop a SKILL.md and have it "just work" without running `apx skills index`.
  try {
    backgroundRefreshIfStale({ projectPath, embedOpts: { ...(embedOpts || {}), globalConfig } });
  } catch { /* best-effort */ }

  // Pull the persistent index. If it's empty (no `apx skills index` ever ran),
  // we don't fall back to recomputing every skill's vector here — that's the
  // job of the index command and the daemon startup probe. Instead, we emit a
  // trace reason so the operator sees "you forgot to index".
  const idx = readIndex();
  const items = idx.items || {};
  const indexedCount = Object.keys(items).length;

  // If the on-disk index has nothing yet, try a JIT pass over the live catalog
  // using the in-process cache. Slower than a primed index but means a fresh
  // install still works — the inspector is supposed to "just work" the moment
  // it's flipped on.
  if (indexedCount === 0) {
    return await inspectFromLive({ text, projectPath, cfg, globalConfig, embedOpts });
  }

  const probe = await embedOne(text, { ...(embedOpts || {}), globalConfig });
  if (!probe || !Array.isArray(probe.vector) || probe.vector.length === 0) {
    return { contextNote: "", trace: { enabled: true, reason: "embed_failed" } };
  }

  // Embedder mismatch — old index was built with a different provider. Don't
  // mix cosine spaces; the operator needs to re-run `apx skills index`.
  if (idx.embedder && idx.embedder !== probe.embedder) {
    return {
      contextNote: "",
      trace: {
        enabled: true,
        reason: "embedder_mismatch",
        embedder: probe.embedder,
        index_embedder: idx.embedder,
      },
    };
  }

  const scored = scoreAgainstIndex(probe.vector, items).filter((s) =>
    isSkillEnabled(s, { config: globalConfig, projectPath }));
  return await pickAndRender({ scored, projectPath, probe, cfg });
}

// ---------------------------------------------------------------------------
// JIT fallback when the persistent index is empty
// ---------------------------------------------------------------------------

async function inspectFromLive({ text, projectPath, cfg, globalConfig, embedOpts }) {
  const skills = filterEnabledSkills(listSkills({ projectPath }), {
    config: globalConfig,
    projectPath,
  });
  if (!skills.length) {
    return { contextNote: "", trace: { enabled: true, reason: "no_skills" } };
  }

  const probe = await embedOne(text, { ...(embedOpts || {}), globalConfig });
  if (!probe || !Array.isArray(probe.vector) || probe.vector.length === 0) {
    return { contextNote: "", trace: { enabled: true, reason: "embed_failed" } };
  }

  const scored = [];
  for (const s of skills) {
    const desc = (s.description || "").slice(0, 600);
    if (!desc.trim()) continue;
    const out = await embedOne(desc, { ...(embedOpts || {}), globalConfig });
    if (!out || !Array.isArray(out.vector)) continue;
    scored.push({
      slug: s.slug,
      source: s.source,
      desc,
      file: s.file,
      sim: cosineSim(probe.vector, out.vector),
    });
  }
  scored.sort((a, b) => b.sim - a.sim);
  const result = await pickAndRender({ scored, projectPath, probe, cfg });
  return {
    contextNote: result.contextNote,
    trace: { ...result.trace, jit: true },
  };
}

// ---------------------------------------------------------------------------
// Common pick + render
// ---------------------------------------------------------------------------

async function pickAndRender({ scored, projectPath, probe, cfg }) {
  if (scored.length === 0) {
    return { contextNote: "", trace: { enabled: true, reason: "no_candidates", embedder: probe.embedder } };
  }
  const top = scored[0];
  const runner = scored[1] || { sim: 0 };

  if (top.sim < cfg.hint_threshold) {
    return {
      contextNote: "",
      trace: {
        enabled: true,
        reason: "below_threshold",
        embedder: probe.embedder,
        scored: scored.slice(0, 5).map((s) => ({ slug: s.slug, sim: Number(s.sim.toFixed(3)) })),
      },
    };
  }

  const loaded = [];
  const hinted = [];

  // High-confidence top picks → inline body. Bounded by max_loaded and require
  // a margin over the runner-up so a flat tie of weak matches doesn't bloat
  // the prompt.
  if (top.sim >= cfg.load_threshold && top.sim - runner.sim >= cfg.margin) {
    for (let i = 0; i < scored.length && loaded.length < cfg.max_loaded; i++) {
      const cand = scored[i];
      if (cand.sim < cfg.load_threshold) break;
      const body = readBodyCapped(cand.slug, projectPath, cfg.body_char_cap);
      if (!body) continue;
      loaded.push({ ...cand, body });
    }
  }

  // Mid-confidence remainder → hint.
  for (const cand of scored) {
    if (loaded.some((l) => l.slug === cand.slug)) continue;
    if (hinted.length >= cfg.max_hints) break;
    if (cand.sim < cfg.hint_threshold) break;
    hinted.push(cand);
  }

  const contextNote = renderInjectedBlock({ loaded, hinted, embedder: probe.embedder });
  return {
    contextNote,
    trace: {
      enabled: true,
      embedder: probe.embedder,
      scored: scored.slice(0, 5).map((s) => ({ slug: s.slug, sim: Number(s.sim.toFixed(3)) })),
      loaded: loaded.map((l) => l.slug),
      hinted: hinted.map((h) => h.slug),
    },
  };
}

function readBodyCapped(slug, projectPath, cap) {
  try {
    const { body } = loadSkill(slug, { projectPath });
    if (!body) return "";
    if (body.length <= cap) return body;
    return body.slice(0, cap) + "\n\n…(skill body truncated — call load_skill for the full text)";
  } catch {
    return "";
  }
}

// Small helper used by the CLI inspect command to print why something fell out.
export function summarizeTrace(trace) {
  if (!trace) return "(no trace)";
  if (!trace.enabled) return `inspector disabled (${trace.reason || "off"})`;
  if (trace.reason && !trace.loaded && !trace.hinted) {
    return `no skill injected: ${trace.reason}`;
  }
  const parts = [];
  if (trace.loaded?.length) parts.push(`loaded: ${trace.loaded.join(", ")}`);
  if (trace.hinted?.length) parts.push(`hinted: ${trace.hinted.join(", ")}`);
  if (!parts.length) parts.push("nothing injected");
  return parts.join(" · ");
}

// Re-exported for callers that want to introspect.
export { readIndex };
