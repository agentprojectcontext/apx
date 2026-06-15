export function compactToolSchema(schema) {
  const fn = schema?.function || {};
  const params = fn.parameters || {};
  const properties = params.properties || {};
  return {
    name: fn.name,
    description: fn.description,
    required: params.required || [],
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, spec]) => [
        name,
        {
          type: spec?.type || "string",
          enum: spec?.enum,
          description: spec?.description,
        },
      ])
    ),
  };
}

export function pseudoToolSystem(system, toolSchemas) {
  const catalog = toolSchemas.map(compactToolSchema);
  return [
    system,
    "# Structured tool fallback",
    "The engine rejected native structured tools. You can still call tools by emitting plain JSON.",
    "When you need a tool, respond ONLY with one JSON object per line:",
    "{\"name\":\"tool_name\",\"arguments\":{\"arg\":\"value\"}}",
    "After tool results arrive, continue the task or give the final answer normally.",
    "Available tools:",
    JSON.stringify(catalog),
  ].join("\n\n");
}

export function shouldRetryWithPseudoTools(modelId, error, alreadyPseudo) {
  if (alreadyPseudo) return false;
  if (!/^ollama:/i.test(String(modelId || ""))) return false;
  const message = String(error?.message || "");
  // Ollama can't always do native/structured tool-calling. Two failure shapes,
  // same fix — drop structured tools and re-run with text-based pseudo-tools
  // (parsed from the prompt, no grammar required):
  //   • 5xx mid-call (model timeout / server error)
  //   • 400 with a JSON/grammar parse error, e.g.
  //     "Value looks like object, but can't find closing '}' symbol"
  if (/ollama\s+5\d\d/i.test(message)) return true;
  if (/ollama\s+400/i.test(message) &&
      /looks like (object|array)|can'?t find closing|unexpected end of json|invalid (json|grammar)/i.test(message)) {
    return true;
  }
  return false;
}
