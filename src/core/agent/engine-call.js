// One-shot engine calls that survive a bad minute.
//
// The agent loop has always walked a fallback chain: a 429 or a 5xx rotates to
// the next model and the turn continues. Every OTHER caller went straight to
// callEngine with a single model id and no chain, so the same rate limit that
// the super-agent shrugged off ended a delegated call outright — "how can it
// rate-limit her if it doesn't rate-limit him" has a boring answer, and this is
// it. `call_agent` was the one that showed: Roby delegates to a project agent,
// Zen answers 429, and the sub-call dies while Roby's own turn would have moved
// to Gemini without saying a word.
//
// Same classifier as the loop (retry.js), same chain (model-router.js), so the
// two agree about what "retryable" means and which model comes next.
import { callEngine } from "../engines/index.js";
import { fallbackModels } from "./model-router.js";
import { isRetryableEngineError, shortRetryReason } from "./retry.js";

/**
 * callEngine, walking the configured fallback chain on retryable failures.
 *
 * @param {object} params        forwarded to callEngine (minus modelId)
 * @param {string} params.modelId the model to try first
 * @param {object} params.config  global/project config; supplies the chain
 * @param {(ev:{model:string,reason:string,retry_with:string})=>void} [onRotate]
 *        called before each rotation, so a caller can log why the model changed
 * @returns {Promise<object>} the engine result, plus `model` — the one that
 *          actually answered, which is not always the one that was asked.
 */
export async function callEngineWithFallback({ modelId, config, ...rest }, { onRotate } = {}) {
  const chain = fallbackModels(config).filter((m) => m && m !== modelId);
  let active = modelId;
  for (;;) {
    try {
      const out = await callEngine({ ...rest, config, modelId: active });
      return { ...out, model: active };
    } catch (e) {
      if (e?.name === "AbortError" || rest.signal?.aborted) throw e;
      if (!chain.length || !isRetryableEngineError(e)) throw e;
      const next = chain.shift();
      try {
        onRotate?.({ model: active, reason: shortRetryReason(e), retry_with: next });
      } catch {
        /* logging must not break the call */
      }
      active = next;
    }
  }
}
