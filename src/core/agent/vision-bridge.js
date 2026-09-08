// Vision bridge: turn attached photos into a short text description for models
// that cannot see pixels (zen:big-pickle and most free Zen models, etc.).
//
// Gemini already renders `m.images` as inlineData. OpenAI/Anthropic wire them
// as multimodal parts. Zen free models advertise chat but not vision — sending
// raw image_url often 400s or is ignored, and the agent roleplays "I can't see
// the photo". Bridging once with a vision model and folding the description
// into the prompt is what makes Candela actually react to a gym selfie.
import { callEngine } from "#core/engines/index.js";
import { modelWiresVision } from "#core/agent/model-capabilities.js";
import { ENGINE_PRESETS } from "#core/engines/presets.js";
import { logWarn } from "#core/logging.js";

// Read from the shared catalog rather than written here.
//
// It used to be the literal "gemini:gemini-2.0-flash", and Google retired that
// model: every bridged image came back as a 404 the caller swallowed, so an
// agent without vision silently stopped being able to see ANYTHING — no error
// surfaced, just "I can't tell what this shows" forever. Found 2026-09-08 via a
// WhatsApp sticker that never got described.
//
// A hardcoded model version is a dated fact wearing a constant's clothes. The
// provider's default in presets.js is the one place that already tracks this.
const DEFAULT_VISION_MODEL = `gemini:${ENGINE_PRESETS.gemini?.default_model || "gemini-3.7-flash"}`;

const BRIDGE_SYSTEM =
  "You describe photos for another AI that cannot see them. Be concrete: who/what, " +
  "clothing, pose, setting, expression. 3–6 sentences. No preamble, no 'the image shows'.";

/** Backward-compatible name used by the turn builder. */
export const providerWiresVision = modelWiresVision;

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
  } catch (e) {
    // Swallowed on purpose — a missing description must not fail the turn — but
    // NOT silently. A retired model returned a 404 here for an unknown length of
    // time and nothing in the log said so.
    logWarn("vision-bridge", `describe failed on ${modelId}: ${e.message}`);
    return null;
  }
}

/** Fold a bridge description into the prompt the text model will read. */
export function withImageDescription(prompt, description) {
  if (!description) return prompt;
  const block = `[Attached photo — you cannot see pixels; this is what it shows:\n${description}\n]`;
  return prompt ? `${prompt}\n\n${block}` : block;
}
