import { parseModelId } from "#core/agent/model-router.js";

// Provider adapters that can serialize APX's internal `message.images` field.
// Custom provider slugs inherit the capability of their configured engine.
const NATIVE_VISION_ENGINES = new Set(["gemini", "anthropic", "openai", "openrouter"]);

export function modelWiresVision(modelId, config = {}) {
  try {
    const { provider } = parseModelId(modelId);
    const engine = config?.engines?.[provider]?.engine || provider;
    return NATIVE_VISION_ENGINES.has(engine);
  } catch {
    return false;
  }
}

function imageLabel(image, index) {
  const candidate = image?.name || image?.path || image?.mime || image?.type;
  const label = typeof candidate === "string" && candidate && !candidate.startsWith("data:")
    ? candidate
    : `imagen ${index + 1}`;
  return `[imagen adjunta: ${label}]`;
}

/**
 * Remove binary images before a text-only fallback sees them. The original
 * messages are never mutated, so a later vision-capable fallback still gets
 * the pixels. A short marker preserves the fact that the turn had an image
 * without leaking base64 into text context.
 */
export function messagesForModel(messages, modelId, config = {}) {
  if (modelWiresVision(modelId, config)) return messages;

  let changed = false;
  const adapted = (messages || []).map((message) => {
    const images = Array.isArray(message?.images) ? message.images.filter(Boolean) : [];
    if (!images.length) return message;
    changed = true;
    const markers = images.map(imageLabel).join("\n");
    const content = typeof message.content === "string"
      ? [message.content, markers].filter(Boolean).join("\n\n")
      : [JSON.stringify(message.content ?? ""), markers].filter(Boolean).join("\n\n");
    const { images: _images, ...rest } = message;
    return { ...rest, content };
  });
  return changed ? adapted : messages;
}
