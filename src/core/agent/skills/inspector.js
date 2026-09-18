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
//   3. Two tiers based on confidence, measured in RELEVANCE (see baseline.js),
//      not raw cosine:
//        - LOAD  (rel ≥ load_z): the body is inlined as contextNote. The agent
//          has it right there — no extra tool call.
//        - HINT  (rel ≥ hint_z): only the slug + one-line description is named,
//          and the agent is told to call load_skill if it actually needs the
//          syntax.
//      Below hint_z, or under the raw_floor sanity check → nothing.
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
import { relevanceScore, embedBaselineCorpus, measureBaseline } from "./baseline.js";

// Defaults — exported so the CLI/web can render them.
// Thresholds are on the RELEVANCE score, not on raw cosine.
//
// Relevance is how far a skill stands above its OWN baseline, in units of its
// own spread (see baseline.js). That is what makes one number mean the same
// thing for every skill: raw cosine does not, because each description has a
// different floor, and thresholding it let three loud descriptions win every
// turn on this install while the matching skills went unnamed.
//
// The `*_z` names are deliberate — the old `load_threshold`/`hint_threshold`
// were cosines, and reusing those keys for a different scale would silently
// re-tune every install that had set them.
export const INSPECTOR_DEFAULTS = Object.freeze({
  enabled: false,             // OPT-IN — this is a test feature.
  load_z: 3.0,                // relevance ≥ this → inline body
  hint_z: 2.2,                // relevance ≥ this → just hint
  margin_z: 0.4,              // top must beat runner-up by this for a confident pick
  // A sanity floor on raw cosine, under the relevance test rather than instead
  // of it. A skill can stand well above its own baseline and still be about
  // nothing the prompt mentions when the baseline itself is very low; this
  // stops that from reaching the prompt. Deliberately loose — the ranking is
  // relevance's job, and a tight floor here would re-introduce the language
  // bias it exists to remove.
  raw_floor: 0.30,
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
    const sim = cosineSim(promptVec, it.desc_vector);
    out.push({
      slug,
      source: it.source,
      desc: it.desc || "",
      file: it.file,
      // `sim` is kept for the trace and the raw floor — it is what a human
      // reading a debug panel expects to see — but `rel` is what ranks.
      sim,
      rel: relevanceScore(sim, it),
    });
  }
  out.sort((a, b) => b.rel - a.rel);
  return out;
}

// ---------------------------------------------------------------------------
// Context block rendering
// ---------------------------------------------------------------------------

// What the model actually reads. Worth writing carefully: this block is the
// entire contract between the retriever and the agent, and its first version
// lost the argument.
//
// It used to head the second tier "Possibly relevant — load on demand" and close
// with "call load_skill … if you need its exact syntax". Both halves invite the
// model to skip: "possibly" is a hedge, and "exact syntax" says the skill is a
// reference manual, so a model that believes it already knows the answer has
// been given permission to not look. What happened next is the failure this
// exists to prevent — asked for an image, with apx-image named right here, the
// agent answered "I don't have an image generation tool" and never called
// load_skill. It was not missing the tool (load_skill is in the base set); it
// was answering a question about its own capabilities from memory instead of
// from the list in front of it.
//
// So the block says the one thing that was missing: a skill is a capability you
// HAVE, and you may not deny one without reading it first.
//
// The scores are deliberately NOT here. `sim 0.34` means nothing to a model and
// a low-looking number is one more excuse to discount the entry; the numbers are
// for the human reading the trace or the settings probe.
function renderInjectedBlock({ loaded, hinted }) {
  if (loaded.length === 0 && hinted.length === 0) return "";

  const lines = [
    "# Skills matched for this message",
    "A skill is a capability you HAVE: it is installed here and its body tells you",
    "how to use it. These matched what the user just wrote.",
    "",
  ];

  if (loaded.length) {
    lines.push("## Loaded — the instructions are right here, use them");
    for (const s of loaded) {
      lines.push("");
      lines.push(`### \`${s.slug}\``);
      lines.push(s.body);
    }
    lines.push("");
  }

  if (hinted.length) {
    lines.push("## Installed and relevant — read before you answer");
    for (const s of hinted) {
      // A description read from a block scalar carries real newlines; this is
      // one markdown list item, so collapse it back to a single line.
      const desc = String(s.desc || "").replace(/\s+/g, " ").trim();
      lines.push(`- \`${s.slug}\` — ${desc}`);
    }
    lines.push("");
    lines.push(
      "If the user is asking for what one of these does, call " +
      "`load_skill({slug:\"…\"})` BEFORE you answer. **Never tell the user you " +
      "cannot do something a skill listed here covers** — load it and read it " +
      "first. If none of them fits, `list_skills` browses the rest.",
    );
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

  const got = await collectCandidates({ text, projectPath, globalConfig, embedOpts });
  if (got.bail) {
    return {
      contextNote: "",
      trace: {
        enabled: true,
        reason: got.bail,
        degraded: !got.probe || got.probe.embedder === "tf",
        ...(got.probe?.embedder ? { embedder: got.probe.embedder } : {}),
        ...(got.index_embedder ? { index_embedder: got.index_embedder } : {}),
      },
    };
  }
  const out = await pickAndRender({ scored: got.scored, projectPath, probe: got.probe, cfg });
  return got.jit
    ? { contextNote: out.contextNote, trace: { ...out.trace, jit: true } }
    : out;
}

// ---------------------------------------------------------------------------
// Candidate collection — the half that is pure measurement
// ---------------------------------------------------------------------------

/**
 * Score every eligible skill against the prompt. Shared by the live turn path
 * and by the dry-run explainer, so what the settings panel shows IS what a turn
 * would have seen — a tester that scored on its own code path would be wrong in
 * exactly the cases you build a tester for.
 *
 * Returns { scored, probe, index_embedder, jit } or { bail: reason, probe? }.
 */
async function collectCandidates({ text, projectPath, globalConfig, embedOpts }) {
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
    return await collectFromLive({ text, projectPath, globalConfig, embedOpts });
  }

  const probe = await embedOne(text, { ...(embedOpts || {}), globalConfig });
  if (!probe || !Array.isArray(probe.vector) || probe.vector.length === 0) {
    return { bail: "embed_failed" };
  }

  // Embedder mismatch — the index was built with a different provider (e.g. the
  // local Ollama server was up when it was indexed and is now down, so we fell
  // back to `tf`). Cosine only means anything within one embedder space, so we
  // can't score this turn. But the line-156 refresh can't detect this on its own
  // (it runs before we know the request-time embedder), so kick a rebuild HERE
  // with the embedder we just probed: planIndex sees embedderChanged and rebuilds
  // the index to the current space, and the NEXT turn scores normally. Without
  // this the mismatch stuck silently until a daemon reboot or `apx skills index`
  // — which is exactly how skill suggestions "just stopped appearing".
  if (idx.embedder && idx.embedder !== probe.embedder) {
    try {
      backgroundRefreshIfStale({
        projectPath,
        embedOpts: { ...(embedOpts || {}), globalConfig },
        currentEmbedder: probe.embedder,
      });
    } catch { /* best-effort */ }
    return { bail: "embedder_mismatch", probe, index_embedder: idx.embedder };
  }

  const scored = scoreAgainstIndex(probe.vector, items).filter((s) =>
    isSkillEnabled(s, { config: globalConfig, projectPath }));
  return { scored, probe, index_embedder: idx.embedder };
}

// ---------------------------------------------------------------------------
// JIT fallback when the persistent index is empty
// ---------------------------------------------------------------------------

async function collectFromLive({ text, projectPath, globalConfig, embedOpts }) {
  const skills = filterEnabledSkills(listSkills({ projectPath }), {
    config: globalConfig,
    projectPath,
  });
  if (!skills.length) {
    return { bail: "no_skills" };
  }

  const probe = await embedOne(text, { ...(embedOpts || {}), globalConfig });
  if (!probe || !Array.isArray(probe.vector) || probe.vector.length === 0) {
    return { bail: "embed_failed" };
  }

  // The background corpus, so this path ranks on the same scale the indexed
  // path does. It is ~16 extra embeds on a route that already pays one per
  // skill — and a fallback that ranked differently from the real thing would be
  // worse than slow, because it would be wrong in a way nobody would notice.
  const corpusVectors = await embedBaselineCorpus(
    (text) => embedOne(text, { ...(embedOpts || {}), globalConfig }),
  );

  const scored = [];
  for (const s of skills) {
    const desc = (s.description || "").slice(0, 600);
    if (!desc.trim()) continue;
    const out = await embedOne(desc, { ...(embedOpts || {}), globalConfig });
    if (!out || !Array.isArray(out.vector)) continue;
    const sim = cosineSim(probe.vector, out.vector);
    const { mu, sd } = measureBaseline(out.vector, corpusVectors);
    scored.push({
      slug: s.slug,
      source: s.source,
      desc,
      file: s.file,
      sim,
      rel: relevanceScore(sim, { base_mu: mu, base_sd: sd }),
    });
  }
  scored.sort((a, b) => b.rel - a.rel);
  return { scored, probe, index_embedder: null, jit: true };
}

// ---------------------------------------------------------------------------
// Common pick + render
// ---------------------------------------------------------------------------

async function pickAndRender({ scored, projectPath, probe, cfg }) {
  // Running on the offline bag-of-words floor. Everything below still works,
  // but the numbers mean much less: `tf` matches literal tokens, so a prompt
  // and a skill that say the same thing in two languages score near zero. The
  // flag rides on the trace so a caller can keep the static skill catalog in
  // the prompt instead of removing it in favour of a RAG that cannot see.
  const degraded = probe.embedder === "tf";
  if (scored.length === 0) {
    return { contextNote: "", trace: { enabled: true, reason: "no_candidates", embedder: probe.embedder, degraded } };
  }
  // Anything below the raw floor is not a weak match, it is an unrelated one —
  // dropped before ranking so it cannot occupy a hint slot that a real
  // candidate needs.
  const eligible = scored.filter((s) => s.sim >= cfg.raw_floor);
  const top = eligible[0];
  const runner = eligible[1] || { rel: 0 };

  if (!top || top.rel < cfg.hint_z) {
    return {
      contextNote: "",
      trace: {
        enabled: true,
        reason: "below_threshold",
        embedder: probe.embedder,
        degraded,
        scored: scored.slice(0, 5).map((s) => ({
          slug: s.slug, sim: Number(s.sim.toFixed(3)), rel: Number(s.rel.toFixed(2)),
        })),
      },
    };
  }

  const loaded = [];
  const hinted = [];

  // High-confidence top picks → inline body. Bounded by max_loaded and required
  // to stand clear of the runner-up, so a flat tie of mediocre matches injects
  // nothing rather than picking a winner out of noise.
  if (top.rel >= cfg.load_z && top.rel - runner.rel >= cfg.margin_z) {
    for (let i = 0; i < eligible.length && loaded.length < cfg.max_loaded; i++) {
      const cand = eligible[i];
      if (cand.rel < cfg.load_z) break;
      const body = readBodyCapped(cand.slug, projectPath, cfg.body_char_cap);
      if (!body) continue;
      loaded.push({ ...cand, body });
    }
  }

  // Mid-confidence remainder → hint.
  for (const cand of eligible) {
    if (loaded.some((l) => l.slug === cand.slug)) continue;
    if (hinted.length >= cfg.max_hints) break;
    if (cand.rel < cfg.hint_z) break;
    hinted.push(cand);
  }

  const contextNote = renderInjectedBlock({ loaded, hinted });
  return {
    contextNote,
    trace: {
      enabled: true,
      embedder: probe.embedder,
      degraded,
      scored: scored.slice(0, 5).map((s) => ({
        slug: s.slug, sim: Number(s.sim.toFixed(3)), rel: Number(s.rel.toFixed(2)),
      })),
      loaded: loaded.map((l) => l.slug),
      hinted: hinted.map((h) => h.slug),
    },
  };
}

// ---------------------------------------------------------------------------
// Dry run — the same decision, with its reasoning shown
// ---------------------------------------------------------------------------

/**
 * Score a prompt and explain, per skill, what the inspector WOULD do with it
 * and why it fell where it did. Same scoring path as a real turn (see
 * collectCandidates) — this is the settings panel's tester, and a tester that
 * agreed with the code only by construction would be worthless.
 *
 * The inspector's own on/off switch is NOT honoured here: a dry run is how you
 * decide whether to turn it on. `enabled` in the result says what the real
 * setting is, so the caller can say so.
 *
 * @returns {{
 *   enabled:boolean, reason:string|null, embedder:string, index_embedder:string|null,
 *   degraded:boolean, jit:boolean, thresholds:object,
 *   loaded:string[], hinted:string[], load_blocked:string|null,
 *   candidates:Array<{slug,source,desc,sim,rel,verdict}>,
 *   contextNote:string,
 * }}
 */
export async function explainPromptForSkills({ prompt, projectPath, globalConfig, embedOpts } = {}) {
  const real = effectiveConfig(globalConfig);
  const cfg = { ...real, enabled: true };
  const base = {
    enabled: real.enabled === true,
    reason: null,
    embedder: "",
    index_embedder: null,
    degraded: false,
    jit: false,
    thresholds: {
      load_z: cfg.load_z, hint_z: cfg.hint_z, margin_z: cfg.margin_z,
      raw_floor: cfg.raw_floor, max_loaded: cfg.max_loaded, max_hints: cfg.max_hints,
      prompt_floor: cfg.prompt_floor,
    },
    loaded: [], hinted: [], load_blocked: null, candidates: [], contextNote: "",
  };

  const text = String(prompt || "").trim();
  if (text.length < cfg.prompt_floor) return { ...base, reason: "prompt_too_short" };

  const got = await collectCandidates({ text, projectPath, globalConfig, embedOpts });
  if (got.bail) {
    return {
      ...base,
      reason: got.bail,
      embedder: got.probe?.embedder || "",
      index_embedder: got.index_embedder || null,
      degraded: (got.probe?.embedder || "") === "tf",
    };
  }

  const decided = await pickAndRender({ scored: got.scored, projectPath, probe: got.probe, cfg });
  const loaded = decided.trace.loaded || [];
  const hinted = decided.trace.hinted || [];

  // Why each one landed where it did. The order matters: the raw floor runs
  // BEFORE ranking (see pickAndRender), so a skill can stand above its own
  // baseline and still be dropped as unrelated — which is the single most
  // confusing outcome to read off a list of numbers, and the one that hid a
  // matching skill on this install.
  const candidates = got.scored.map((s) => {
    let verdict;
    if (loaded.includes(s.slug)) verdict = "loaded";
    else if (hinted.includes(s.slug)) verdict = "hinted";
    else if (s.sim < cfg.raw_floor) verdict = "unrelated";
    else if (s.rel < cfg.hint_z) verdict = "weak";
    // Above both bars and still not in — the slots (max_loaded / max_hints)
    // were already taken by better-ranked skills.
    else verdict = "capped";
    return {
      slug: s.slug,
      source: s.source || "",
      desc: String(s.desc || "").replace(/\s+/g, " ").trim().slice(0, 240),
      sim: Number(s.sim.toFixed(3)),
      rel: Number(s.rel.toFixed(2)),
      verdict,
    };
  });

  // When nothing was inlined, say which of the two gates stopped it — the score
  // itself, or the margin over the runner-up.
  const eligible = got.scored.filter((s) => s.sim >= cfg.raw_floor);
  let load_blocked = null;
  if (!loaded.length && eligible.length) {
    const [top, runner = { rel: 0 }] = eligible;
    if (top.rel < cfg.load_z) load_blocked = "below_load_z";
    else if (top.rel - runner.rel < cfg.margin_z) load_blocked = "margin";
  }

  return {
    ...base,
    reason: decided.trace.reason || null,
    embedder: got.probe.embedder || "",
    index_embedder: got.index_embedder || null,
    degraded: got.probe.embedder === "tf",
    jit: !!got.jit,
    loaded, hinted, load_blocked, candidates,
    contextNote: decided.contextNote,
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

// What of the inspector trace is worth keeping on disk: the decision, not the
// payload. `null` only when the inspector had nothing to say at all — no skill
// injected AND no candidate scored. When it scored candidates but none crossed
// the load/hint bar we STILL keep the row: a reopened thread should be able to
// show what was suggested each round (the "considered" near-misses), which is
// what makes the per-turn RAG legible instead of silently doing nothing.
export function inspectorRecord(trace) {
  if (!trace?.enabled) return null;
  const loaded = trace.loaded || [];
  const hinted = trace.hinted || [];
  const scored = trace.scored || [];
  if (loaded.length === 0 && hinted.length === 0 && scored.length === 0) return null;
  return {
    ...(trace.embedder ? { embedder: trace.embedder } : {}),
    ...(loaded.length ? { loaded } : {}),
    ...(hinted.length ? { hinted } : {}),
    // Already capped at the top 5 upstream — the similarities the badge shows,
    // and the source of the dim "considered" badges when nothing was injected.
    ...(scored.length ? { scored } : {}),
  };
}

// The inspector exists to REPLACE the static "Available skills" slug dump in
// the system prompt — that is the whole token argument for it. But replacing a
// catalog with a retriever that cannot retrieve leaves the agent with neither,
// which is how a machine with no embedding model ends up answering "I have no
// tool for that" about a skill it has. So: drop the catalog only when the
// inspector actually did its job.
//
// It did its job when it injected something, or when it ran a real embedder and
// decided — honestly — that nothing matched. It did not when the embedder was
// the offline `tf` floor, or when it never scored at all.
export function shouldKeepSkillsHint(trace) {
  if (!trace?.enabled) return true;          // inspector off → catalog as before
  if (trace.loaded?.length || trace.hinted?.length) return false;
  if (trace.degraded) return true;
  return !trace.embedder;                    // never scored → keep the catalog
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
