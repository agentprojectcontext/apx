// Which model an APC agent runs on. Single home for the question "what does
// this agent's `Model:` field mean?" — every caller (daemon routes, routines,
// the call_agent tool, A2A, the Telegram routed agent) goes through here.
//
// The field has three states, not two:
//
//   Model: groq:llama-3.3-70b-versatile   → forced. This model, no router.
//   Model: inherit                        → no override. APC's normalizer
//                                           writes this marker, and it is the
//                                           documented idiom in
//                                           `.apc/agents/<slug>.md`.
//   (absent / empty)                      → no override.
//
// `inherit` used to reach `callEngine` as a literal model id, which parses as a
// provider-less name and fails the run. It is a marker, never a model.
import { resolveActiveModel } from "./model-router.js";

const INHERIT = "inherit";

/**
 * The model this agent forces, or `""` when it inherits.
 * @param {{ fields?: Record<string, unknown> }} agent an entry from readAgents()
 */
export function agentForcedModel(agent) {
  const raw = agent?.fields?.Model;
  if (typeof raw !== "string") return "";
  const model = raw.trim();
  if (!model || model.toLowerCase() === INHERIT) return "";
  return model;
}

/** Whether a raw `Model:` value means "inherit" (absent, empty or the marker). */
export function isInheritedModel(model) {
  if (typeof model !== "string") return !model;
  const v = model.trim();
  return !v || v.toLowerCase() === INHERIT;
}

/**
 * The model to actually call for this agent: an explicit per-call override
 * first, then the agent's forced model, then whatever the router resolves for
 * the super-agent (which walks the fallback chain and skips unhealthy
 * providers). Returns `null` when nothing is configured anywhere.
 */
export async function resolveAgentModel({ agent, config, override } = {}) {
  // Per-call override (the chat picker) wins only when it is a real model
  // id. `inherit` / empty from the picker means "use the agent's card", not
  // "call a provider named inherit". The agent's own `Model: inherit` then
  // falls through to the router.
  const forced = agentForcedModel({ fields: { Model: override ?? "" } }) || agentForcedModel(agent);
  if (forced) return forced;
  try {
    const routing = await resolveActiveModel(config);
    return routing?.modelId || null;
  } catch {
    return null;
  }
}
