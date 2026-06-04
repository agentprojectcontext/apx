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
  const message = String(error?.message || "");
  return /^ollama:/i.test(String(modelId || "")) && /ollama\s+500/i.test(message);
}
