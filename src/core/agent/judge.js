// Goal-completion judge loop (OpenHands Critic / iterative-refinement
// pattern). An LLM judge scores how likely the ORIGINAL goal is actually met
// (0..1); below the threshold the agent gets a follow-up verification note and
// continues — bounded by max_iterations so a harsh judge can't spin forever.
//
// It serves two different failures, through the same loop:
//
//   - Completion-contract turns (coding surfaces) declare "done" themselves,
//     and the judge checks that claim. Opt-in: `judge.enabled`.
//   - Conversational turns (Telegram, web chat) end whenever the model stops
//     calling tools — which it also does when it merely ANNOUNCES the next step
//     ("ahora genero el SRT en inglés") and writes no call. Nothing declared
//     anything; the task just stopped halfway and waited to be poked. Here the
//     judge IS the poke, and it is on by default (`judge.continue_unfinished`).
import { callEngine } from "../engines/index.js";
import { TURN_ENDING_TOOLS } from "./tools/names.js";

export function judgeConfig(globalConfig) {
  const raw = globalConfig?.super_agent?.judge || {};
  const threshold = Number(raw.success_threshold);
  const iters = parseInt(raw.max_iterations, 10);
  return {
    // Verify a contract turn's own "done". Opt-in — the coding surfaces pay a
    // judge call per finish, and not every deployment wants that.
    enabled: raw.enabled === true,
    // Continue a conversational turn that stopped mid-task. On unless switched
    // off: a turn that quits after announcing its next step reads as a bug, and
    // the alternative is the user typing "seguí" to restart it by hand.
    continue_unfinished: raw.continue_unfinished !== false,
    success_threshold:
      Number.isFinite(threshold) && threshold > 0 && threshold <= 1 ? threshold : 0.6,
    max_iterations: Number.isFinite(iters) && iters > 0 ? Math.min(iters, 5) : 2,
    model: typeof raw.model === "string" ? raw.model : "",
  };
}

const JUDGE_SYSTEM =
  "You are a strict completion judge for an autonomous agent. You read the " +
  "user's original request and the agent's final report plus action trace, and " +
  "estimate the probability that the request is FULLY satisfied. Judge only " +
  "what the evidence supports: claims without a matching action in the trace " +
  "count against completion. Answer with STRICT JSON only.";

function judgePrompt({ goal, finalText, traceSummary }) {
  return [
    "ORIGINAL REQUEST:",
    goal,
    "",
    "AGENT'S FINAL REPORT:",
    finalText || "(empty)",
    "",
    "ACTION TRACE (tool, outcome preview):",
    traceSummary || "(no tools ran)",
    "",
    'Reply with STRICT JSON, nothing else: {"score": <0..1 probability the request is fully satisfied>, "reasoning": "<one dense sentence>", "missing": ["<unmet requirement>", ...]}',
  ].join("\n");
}

export function summarizeTraceForJudge(trace, { maxItems = 20 } = {}) {
  if (!Array.isArray(trace) || trace.length === 0) return "";
  return trace
    .slice(-maxItems)
    .map((t) => {
      const r = t?.result;
      const preview =
        typeof r === "string"
          ? r
          : r && typeof r === "object"
            ? (r.error ? `error: ${r.error}` : JSON.stringify(r))
            : String(r);
      return `- ${t.tool}: ${String(preview).slice(0, 160)}`;
    })
    .join("\n");
}

export function parseVerdict(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  if (start === -1) return null;
  // Walk to the matching close brace so trailing prose can't break the parse.
  let depth = 0;
  let end = -1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const score = Number(obj.score);
    if (!Number.isFinite(score)) return null;
    return {
      score: Math.max(0, Math.min(1, score)),
      reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
      missing: Array.isArray(obj.missing) ? obj.missing.filter((m) => typeof m === "string") : [],
    };
  } catch {
    return null;
  }
}

/**
 * Score a finished run against its goal. Returns {score, reasoning, missing}
 * or null when the judge is unusable (engine down, unparseable reply) — the
 * caller treats null as "accept the result", never as a failure.
 */
export async function judgeCompletion({ goal, result, globalConfig, callEngineFn = callEngine }) {
  const cfg = judgeConfig(globalConfig);
  const modelId = cfg.model || globalConfig?.super_agent?.model || "";
  if (!modelId) return null;
  try {
    const r = await callEngineFn({
      modelId,
      system: JUDGE_SYSTEM,
      messages: [
        {
          role: "user",
          content: judgePrompt({
            goal,
            finalText: result?.text || "",
            traceSummary: summarizeTraceForJudge(result?.trace),
          }),
        },
      ],
      config: globalConfig,
      maxTokens: 500,
      temperature: 0,
    });
    return parseVerdict(r?.text);
  } catch {
    return null;
  }
}

// In-band note, adapted from OpenHands CriticBase.get_followup_prompt: shapes
// behavior, never words. The model must re-verify against the ORIGINAL
// request, not against the judge's phrasing.
export function buildJudgeFollowup(verdict, iteration) {
  const pct = Math.round((verdict?.score ?? 0) * 100);
  const missing = (verdict?.missing || []).slice(0, 5);
  return [
    `[Internal verification note — this is NOT from the user. An automated completion check scored this turn ${pct}% likely complete (verification round ${iteration}).`,
    verdict?.reasoning ? `Judge's reasoning: ${verdict.reasoning}` : "",
    missing.length ? `Possibly unmet: ${missing.map((m) => `"${m}"`).join(", ")}.` : "",
    "Re-read the user's ORIGINAL request, verify each requirement against what you actually did (check the tool results, don't assume), complete whatever is genuinely missing, then finish. If everything IS already complete, finish with a summary stating precisely why each requirement is met.]",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Is this conversational turn one worth checking — and continuing if unfinished?
 *
 * Two exclusions, both about not spending a call to learn nothing:
 *   - a turn that ran no tools is chat, and chat has no half-done work; judging
 *     it would be one model call per "hola".
 *   - a turn that ended by ASKING the user is not unfinished, it is waiting. A
 *     verdict of "not complete" there would push the agent to answer its own
 *     question instead of letting the person answer it.
 *
 * @param {{trace?: {tool?: string}[]}} result a runAgent result
 */
export function continuableTurn(result) {
  const trace = Array.isArray(result?.trace) ? result.trace : [];
  if (trace.length === 0) return false;
  return !trace.some((t) => TURN_ENDING_TOOLS.has(String(t?.tool || "")));
}

/**
 * Refinement driver, dependency-injected so surfaces and tests supply their
 * own judge/runner. `judgeFn(result)` → verdict|null; `runFollowup(followupPrompt,
 * result)` → next run result. Merges usage and traces across rounds and
 * attaches the verdict trail as `result.judge`.
 */
export async function applyJudgeLoop({ initialResult, cfg, judgeFn, runFollowup, onEvent = null }) {
  let result = initialResult;
  const trail = [];
  for (let i = 1; i <= cfg.max_iterations; i++) {
    const verdict = await judgeFn(result);
    if (verdict) {
      trail.push({ iteration: i, ...verdict });
      if (typeof onEvent === "function") {
        await onEvent({
          type: "judge_verdict",
          iteration: i,
          score: verdict.score,
          reasoning: verdict.reasoning,
          passed: verdict.score >= cfg.success_threshold,
        });
      }
    }
    if (!verdict || verdict.score >= cfg.success_threshold) break;
    const next = await runFollowup(buildJudgeFollowup(verdict, i), result);
    result = {
      ...next,
      usage: {
        input_tokens: (result.usage?.input_tokens || 0) + (next.usage?.input_tokens || 0),
        output_tokens: (result.usage?.output_tokens || 0) + (next.usage?.output_tokens || 0),
      },
      trace: [...(result.trace || []), ...(next.trace || [])],
    };
  }
  return trail.length ? { ...result, judge: trail } : result;
}
