// Vision bridge: turn attached photos into a short text description for models
// that cannot see pixels (zen:big-pickle and most free Zen models, etc.).
//
// Gemini already renders `m.images` as inlineData. OpenAI/Anthropic wire them
// as multimodal parts. Zen free models advertise chat but not vision — sending
// raw image_url often 400s or is ignored, and the agent roleplays "I can't see
// the photo". Bridging once with a vision model and folding the description
// into the prompt is what makes Candela actually react to a gym selfie.
import { callEngine } from "#core/engines/index.js";
import { parseModelId } from "#core/agent/model-router.js";

const DEFAULT_VISION_MODEL = "gemini:gemini-2.0-flash";

const BRIDGE_SYSTEM =
  "You describe photos for another AI that cannot see them. Be concrete: who/what, " +
  "clothing, pose, setting, expression. 3–6 sentences. No preamble, no 'the image shows'.";

/** Providers that render `message.images` natively on the wire. Everything
 *  else gets a text description instead of (or as well as) raw bytes. */
const NATIVE_VISION_PROVIDERS = new Set(["gemini", "anthropic", "openai", "openrouter"]);

export function providerWiresVision(modelId) {
  try {
    return NATIVE_VISION_PROVIDERS.has(parseModelId(modelId).provider);
  } catch {
    return false;
  }
}

export function visionBridgeModel(globalConfig) {
  const configured = globalConfig?.super_agent?.vision_bridge_model;
  if (typeof configured === "string" && configured.includes(":")) return configured;
  // Prefer an explicit has_image routing target if the operator already named one.
  const rules = globalConfig?.super_agent?.routing?.rules;
  if (Array.isArray(rules)) {
    for (const r of rules) {
      if (r?.when?.has_image === true && typeof r.model === "string" && r.model.includes(":")) {
        return r.model;
      }
    }
  }
  return DEFAULT_VISION_MODEL;
}

/**
 * Describe turn images with a vision model. Returns null on failure (no key,
 * model down) so the caller can keep going with the path marker alone.
 */
export async function describeTurnImages(images, globalConfig, { signal } = {}) {
  const usable = (images || []).filter((im) => im && im.data && im.mime);
  if (!usable.length) return null;
  const modelId = visionBridgeModel(globalConfig);
  try {
    const result = await callEngine({
      modelId,
      system: BRIDGE_SYSTEM,
      messages: [{
        role: "user",
        content: usable.length === 1 ? "Describe this photo." : `Describe these ${usable.length} photos.`,
        images: usable.map((im) => ({ data: im.data, mime: im.mime })),
      }],
      config: globalConfig,
      maxTokens: 500,
      signal,
    });
    const text = (result.text || "").trim();
    return text || null;
  } catch {
    return null;
  }
}

/** Fold a bridge description into the prompt the text model will read. */
export function withImageDescription(prompt, description) {
  if (!description) return prompt;
  const block = `[Attached photo — you cannot see pixels; this is what it shows:\n${description}\n]`;
  return prompt ? `${prompt}\n\n${block}` : block;
}
