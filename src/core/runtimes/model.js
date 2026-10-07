// Which model an external runtime CLI is asked to use, and why.
//
// APX's engine selection (`chatgpt-codex:gpt-6-luna@high`) and a runtime CLI's
// own config (`~/.codex/config.toml`) are independent: `model: inherit` means
// each runtime applies its own default. That contract stays the default. What
// was missing is a way to SAY otherwise, and a record of what was asked — a
// session that silently ran another model than the panel showed failed with an
// HTTP 400 nobody could trace.
//
// Precedence, first match wins:
//   1. `model` / `effort` passed on the call            source "call"
//   2. config `runtimes.<id>.model` / `.effort`         source "config"
//   3. config `runtimes.<id>.inherit_apx_model: true`   source "apx_inherit"
//      — only when APX's model is from a provider NATIVE to that runtime
//   4. nothing                                          source "runtime_default"
//
// Never passes `provider:model@effort` raw as a CLI id: it is split, and a
// provider the runtime cannot serve is an error (explicit) or a note (inherit).
// A runtime adapter declares what it honors (`modelOptions`, `nativeProviders`);
// asking one that cannot is a specific error, never a silently dropped flag.
import { parseModelId } from "#core/agent/model-router.js";
import { ENGINE_PRESETS } from "#core/engines/presets.js";

export const RUNTIME_EFFORTS = Object.freeze([...(ENGINE_PRESETS["codex-plus"]?.efforts || ["minimal", "low", "medium", "high", "xhigh"])]);

/** "chatgpt-codex:gpt-6-luna@high" → { provider, model, effort }; bare ids keep provider null. */
export function splitRuntimeModel(raw) {
  let text = String(raw || "").trim();
  if (!text) return { provider: null, model: null, effort: null };
  let effort = null;
  const at = text.lastIndexOf("@");
  if (at > 0 && RUNTIME_EFFORTS.includes(text.slice(at + 1).toLowerCase())) {
    effort = text.slice(at + 1).toLowerCase();
    text = text.slice(0, at);
  }
  if (!text.includes(":")) return { provider: null, model: text, effort };
  const { provider, model } = parseModelId(text);
  return { provider, model, effort };
}

function runtimeConfig(config, runtimeId) {
  const r = config?.runtimes?.[runtimeId];
  return r && typeof r === "object" ? r : {};
}

/**
 * @param {object} args
 * @param {string} args.runtimeId
 * @param {object} args.adapter        the runtime adapter (modelOptions, nativeProviders)
 * @param {string} [args.model]        explicit, from the call
 * @param {string} [args.effort]       explicit, from the call
 * @param {object} [args.config]       effective APX config
 * @param {string} [args.apxModelId]   the APX model the caller resolved, for inherit mode
 * @returns {{ model: string|null, effort: string|null, source: string, requested: string|null,
 *             note?: string, error?: string }}
 */
export function resolveRuntimeModel({ runtimeId, adapter, model = null, effort = null, config = {}, apxModelId = null }) {
  const caps = adapter?.modelOptions || {};
  const native = adapter?.nativeProviders || [];
  const rc = runtimeConfig(config, runtimeId);

  const pick = (rawModel, rawEffort, source) => {
    const requested = [rawModel, rawEffort ? `@${rawEffort}` : ""].filter(Boolean).join("") || null;
    const parts = splitRuntimeModel(rawModel);
    const eff = rawEffort ? String(rawEffort).toLowerCase() : parts.effort;
    if (parts.provider && !native.includes(parts.provider)) {
      return {
        model: null, effort: null, source, requested,
        error: `"${rawModel}" is a ${parts.provider} model; ${runtimeId} cannot run it. Pass the runtime's own model id ` +
          `(${native.length ? `a ${native.join("/")} model` : "it takes none from APX"}) or omit model.`,
      };
    }
    // Goes onto a command line as a flag value: a runtime's model id never
    // starts with "-" or carries spaces, so anything else is refused, not passed.
    if (parts.model && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(parts.model)) {
      return { model: null, effort: null, source, requested, error: `"${parts.model}" is not a valid model id.` };
    }
    if (parts.model && !caps.model) {
      return { model: null, effort: null, source, requested, error: `${runtimeId} does not take a model from APX; configure it in the CLI itself or omit model.` };
    }
    if (eff && !RUNTIME_EFFORTS.includes(eff)) {
      return { model: null, effort: null, source, requested, error: `unknown effort "${eff}" (use ${RUNTIME_EFFORTS.join(", ")}).` };
    }
    if (eff && !caps.effort) {
      return { model: null, effort: null, source, requested, error: `${runtimeId} does not take a reasoning effort from APX; omit effort.` };
    }
    return { model: parts.model || null, effort: eff || null, source, requested };
  };

  if (model || effort) return pick(model, effort, "call");
  if (rc.model || rc.effort) return pick(rc.model || null, rc.effort || null, "config");

  if (rc.inherit_apx_model === true && apxModelId) {
    let parts;
    try { parts = splitRuntimeModel(apxModelId); } catch { parts = { provider: null }; }
    if (parts.provider && native.includes(parts.provider) && caps.model) {
      return {
        model: parts.model,
        effort: caps.effort ? parts.effort : null,
        source: "apx_inherit",
        requested: apxModelId,
      };
    }
    return {
      model: null, effort: null, source: "runtime_default", requested: apxModelId,
      note: `APX model ${apxModelId} is not native to ${runtimeId}; the CLI's own default model was used.`,
    };
  }
  return { model: null, effort: null, source: "runtime_default", requested: null };
}
